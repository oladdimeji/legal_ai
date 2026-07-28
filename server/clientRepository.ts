import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { OwnershipContext } from "./db.js";
import { db } from "./db.js";
import type { EmailDeliveryRecord, EmailDeliveryRecorder } from "./transactionalEmail.js";

export type ClientSessionAccount = {
  client: {
    id: string;
    name: string;
    email: string;
    status: "active" | "suspended";
    emailVerified: boolean;
  };
};

export type ClientPrincipal = {
  clientUserId: string;
  name: string;
  email: string;
};

function clientId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

async function notifyLawyers(
  client: pg.PoolClient,
  input: {
    firmId: string;
    caseId: string;
    actorClientUserId: string;
    type: string;
    title: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO client_notifications
      (id, firm_id, case_id, recipient_user_id, actor_client_user_id,
       notification_type, title, deep_link, created_at)
     SELECT 'notification_' || gen_random_uuid(), $1, $2, fm.user_id, $3,
       $4, $5, '/app/matters/' || $2, NOW()
     FROM firm_memberships fm
     LEFT JOIN notification_preferences np
       ON np.recipient_kind = 'lawyer' AND np.recipient_id = fm.user_id
     WHERE fm.firm_id = $1 AND fm.status = 'active'
       AND fm.role IN ('firm_admin', 'lawyer')
       AND COALESCE(np.in_app_enabled, TRUE) = TRUE
       AND (
         fm.role = 'firm_admin'
         OR EXISTS (
           SELECT 1
           FROM matter_assignments ma
           WHERE ma.firm_id = fm.firm_id
             AND ma.case_id = $2
             AND ma.user_id = fm.user_id
             AND ma.status = 'active'
         )
       )`,
    [input.firmId, input.caseId, input.actorClientUserId, input.type, input.title],
  );
}

export class ClientRepository implements EmailDeliveryRecorder {
  async getMatterLawyerEmailRecipients(
    clientUserId: string,
    caseId: string,
  ): Promise<Array<{ id: string; name: string; email: string }>> {
    return db.query(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM matter_client_memberships m
       JOIN firm_memberships fm
         ON fm.firm_id = m.firm_id AND fm.status = 'active'
       JOIN users u ON u.id = fm.user_id
       LEFT JOIN notification_preferences p
         ON p.recipient_kind = 'lawyer' AND p.recipient_id = u.id
       WHERE m.client_user_id = $1 AND m.case_id = $2 AND m.status = 'active'
         AND fm.role IN ('firm_admin', 'lawyer')
         AND COALESCE(p.email_enabled, TRUE) = TRUE
         AND (
           fm.role = 'firm_admin'
           OR EXISTS (
             SELECT 1 FROM matter_assignments ma
             WHERE ma.firm_id = m.firm_id AND ma.case_id = m.case_id
               AND ma.user_id = fm.user_id AND ma.status = 'active'
           )
         )`,
      [clientUserId, caseId],
    );
  }

  async getMatterClientAccess(context: OwnershipContext, caseId: string): Promise<any> {
    const matters = await db.query(
      `SELECT id FROM cases WHERE id = $1 AND firm_id = $2`,
      [caseId, context.firmId],
    );
    if (matters.length !== 1) throw new Error("Matter not found");
    const [memberships, invitations] = await Promise.all([
      db.query(
        `SELECT m.id, m.status, m.activated_at, m.suspended_at, m.removed_at,
           cu.id AS client_user_id, cu.name, cu.email
         FROM matter_client_memberships m
         JOIN client_users cu ON cu.id = m.client_user_id
         WHERE m.firm_id = $1 AND m.case_id = $2
         ORDER BY m.created_at`,
        [context.firmId, caseId],
      ),
      db.query(
        `UPDATE client_invitations
         SET status = CASE WHEN status = 'pending' AND expires_at <= NOW()
           THEN 'expired' ELSE status END,
           updated_at = CASE WHEN status = 'pending' AND expires_at <= NOW()
             THEN NOW() ELSE updated_at END
         WHERE firm_id = $1 AND case_id = $2
         RETURNING id, email, client_name, status, expires_at, accepted_at, revoked_at`,
        [context.firmId, caseId],
      ),
    ]);
    return { memberships, invitations };
  }

  async notifyMatterClients(input: {
    context: OwnershipContext;
    caseId: string;
    type: string;
    title: string;
  }): Promise<Array<{ id: string; name: string; email: string }>> {
    const recipients = await db.query(
      `SELECT cu.id, cu.name, cu.email
       FROM matter_client_memberships m
       JOIN cases c ON c.id = m.case_id AND c.firm_id = m.firm_id
       JOIN client_users cu ON cu.id = m.client_user_id AND cu.status = 'active'
       LEFT JOIN notification_preferences p
         ON p.recipient_kind = 'client' AND p.recipient_id = cu.id
       WHERE m.firm_id = $1 AND m.case_id = $2 AND m.status = 'active'
         AND COALESCE(p.email_enabled, TRUE) = TRUE`,
      [input.context.firmId, input.caseId],
    );
    await db.query(
      `INSERT INTO client_notifications
        (id, firm_id, case_id, recipient_client_user_id, actor_user_id,
         notification_type, title, deep_link, created_at)
       SELECT 'notification_' || gen_random_uuid(), m.firm_id, m.case_id,
         m.client_user_id, $2, $4, $5, '/client/dashboard?matter=' || m.case_id, NOW()
       FROM matter_client_memberships m
       JOIN cases c ON c.id = m.case_id AND c.firm_id = m.firm_id
       LEFT JOIN notification_preferences p
         ON p.recipient_kind = 'client' AND p.recipient_id = m.client_user_id
       WHERE m.firm_id = $1 AND m.case_id = $3 AND m.status = 'active'
         AND COALESCE(p.in_app_enabled, TRUE) = TRUE`,
      [input.context.firmId, input.context.userId, input.caseId, input.type, input.title],
    );
    return recipients;
  }

  async createInvitation(input: {
    context: OwnershipContext;
    caseId: string;
    clientName: string;
    email: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<any> {
    return db.transaction(async (client) => {
      const matter = await client.query(
        `SELECT c.id, c.name
         FROM cases c
         WHERE c.id = $1 AND c.firm_id = $2 AND c.lifecycle_state <> 'deleted'
         FOR UPDATE`,
        [input.caseId, input.context.firmId],
      );
      if (matter.rowCount !== 1) throw new Error("Matter not found");
      await client.query(
        `UPDATE client_invitations
         SET status = 'expired', updated_at = NOW()
         WHERE firm_id = $1 AND case_id = $2 AND normalized_email = $3
           AND status = 'pending' AND expires_at <= NOW()`,
        [input.context.firmId, input.caseId, input.email],
      );
      const id = clientId("client_invitation");
      const inserted = await client.query(
        `INSERT INTO client_invitations
          (id, firm_id, case_id, email, normalized_email, client_name,
           token_hash, status, invited_by_user_id, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4, $5, $6, 'pending', $7, $8, NOW(), NOW())
         RETURNING id, email, client_name, status, expires_at`,
        [id, input.context.firmId, input.caseId, input.email, input.clientName,
          input.tokenHash, input.context.userId, input.expiresAt],
      );
      return { ...inserted.rows[0], matter_name: matter.rows[0].name };
    });
  }

  async revokeInvitation(context: OwnershipContext, caseId: string, invitationId: string): Promise<boolean> {
    const rows = await db.query(
      `UPDATE client_invitations
       SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND firm_id = $2 AND case_id = $3 AND status = 'pending'
       RETURNING id`,
      [invitationId, context.firmId, caseId],
    );
    return rows.length === 1;
  }

  async getInvitation(tokenHash: string): Promise<any | null> {
    const rows = await db.query(
      `UPDATE client_invitations i
       SET status = CASE WHEN i.status = 'pending' AND i.expires_at <= NOW()
         THEN 'expired' ELSE i.status END,
         updated_at = CASE WHEN i.status = 'pending' AND i.expires_at <= NOW()
           THEN NOW() ELSE i.updated_at END
       FROM cases c, firm f, users u
       WHERE i.token_hash = $1 AND c.id = i.case_id AND c.firm_id = i.firm_id
         AND f.id = i.firm_id AND u.id = i.invited_by_user_id
       RETURNING i.*, c.name AS matter_name, f.name AS firm_name, u.name AS lawyer_name`,
      [tokenHash],
    );
    return rows[0] || null;
  }

  async getClientCredential(normalizedEmail: string): Promise<any | null> {
    const rows = await db.query(
      `SELECT id, name, email, normalized_email, password_hash, status,
         email_verified_at
       FROM client_users WHERE normalized_email = $1`,
      [normalizedEmail],
    );
    return rows[0] || null;
  }

  async acceptInvitation(input: {
    tokenHash: string;
    name: string;
    passwordHash: string | null;
    existingClientUserId: string | null;
    verificationTokenHash: string | null;
    verificationExpiresAt: string | null;
    markEmailVerified: boolean;
  }): Promise<{
    clientUserId: string;
    firmId: string;
    caseId: string;
    membershipId: string;
    email: string;
    name: string;
    matterName: string;
    emailVerified: boolean;
  }> {
    return db.transaction(async (client) => {
      const invitationResult = await client.query(
        `SELECT i.*, c.name AS matter_name
         FROM client_invitations i
         JOIN cases c ON c.id = i.case_id AND c.firm_id = i.firm_id
         WHERE i.token_hash = $1 AND i.status = 'pending' AND i.expires_at > NOW()
         FOR UPDATE OF i`,
        [input.tokenHash],
      );
      const invitation = invitationResult.rows[0];
      if (!invitation) throw new Error("Invitation is unavailable or expired");
      let clientUserId = input.existingClientUserId;
      let emailVerified = false;
      if (clientUserId) {
        const existing = await client.query(
          `SELECT id, email_verified_at FROM client_users
           WHERE id = $1 AND normalized_email = $2 AND status = 'active'
           FOR UPDATE`,
          [clientUserId, invitation.normalized_email],
        );
        if (existing.rowCount !== 1) throw new Error("Invitation cannot be linked to this account");
        emailVerified = Boolean(existing.rows[0].email_verified_at);
      } else {
        if (
          !input.passwordHash
          || (!input.markEmailVerified && (!input.verificationTokenHash || !input.verificationExpiresAt))
        ) {
          throw new Error("New client credentials are incomplete");
        }
        clientUserId = clientId("client_user");
        await client.query(
          `INSERT INTO client_users
            (id, name, email, normalized_email, password_hash, status,
             email_verified_at, created_at, updated_at)
           VALUES ($1, $2, $3, $3, $4, 'active',
             CASE WHEN $5::boolean THEN NOW() ELSE NULL END, NOW(), NOW())`,
          [clientUserId, input.name, invitation.normalized_email, input.passwordHash,
            input.markEmailVerified],
        );
        if (!input.markEmailVerified) {
          await client.query(
            `INSERT INTO client_email_verification_tokens
              (id, client_user_id, token_hash, status, expires_at, created_at)
             VALUES ($1, $2, $3, 'pending', $4, NOW())`,
            [clientId("client_verification"), clientUserId, input.verificationTokenHash,
              input.verificationExpiresAt],
          );
        } else {
          emailVerified = true;
        }
      }
      const membershipId = clientId("client_membership");
      await client.query(
        `INSERT INTO matter_client_memberships
          (id, firm_id, case_id, client_user_id, status, invited_by_user_id,
           activated_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, NOW(), NOW(), NOW())
         ON CONFLICT (case_id, client_user_id) DO UPDATE
           SET status = 'active', invited_by_user_id = EXCLUDED.invited_by_user_id,
             activated_at = NOW(), suspended_at = NULL, removed_at = NULL,
             updated_at = NOW()
         RETURNING id`,
        [membershipId, invitation.firm_id, invitation.case_id, clientUserId,
          invitation.invited_by_user_id],
      );
      const finalMembershipId = (await client.query(
        `SELECT id FROM matter_client_memberships
         WHERE case_id = $1 AND client_user_id = $2`,
        [invitation.case_id, clientUserId],
      )).rows[0].id;
      await client.query(
        `UPDATE client_invitations
         SET status = 'accepted', accepted_by_client_user_id = $2,
           accepted_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [invitation.id, clientUserId],
      );
      await client.query(
        `INSERT INTO client_activity_records
          (id, firm_id, case_id, client_user_id, membership_id, activity_type,
           resource_type, resource_id, visibility, summary, created_at)
         VALUES ($1, $2, $3, $4, $5, 'invitation_accepted',
           'membership', $5, 'shared', 'Client accepted invitation', NOW())`,
        [clientId("client_activity"), invitation.firm_id, invitation.case_id,
          clientUserId, finalMembershipId],
      );
      await notifyLawyers(client, {
        firmId: invitation.firm_id,
        caseId: invitation.case_id,
        actorClientUserId: clientUserId,
        type: "client_invitation_accepted",
        title: `${invitation.client_name} accepted the Matter invitation`,
      });
      return {
        clientUserId,
        firmId: invitation.firm_id,
        caseId: invitation.case_id,
        membershipId: finalMembershipId,
        email: invitation.normalized_email,
        name: input.name || invitation.client_name,
        matterName: invitation.matter_name,
        emailVerified,
      };
    });
  }

  async verifyEmail(tokenHash: string): Promise<{ clientUserId: string } | null> {
    return db.transaction(async (client) => {
      const result = await client.query(
        `UPDATE client_email_verification_tokens t
         SET status = 'used', used_at = NOW()
         WHERE t.token_hash = $1 AND t.status = 'pending' AND t.expires_at > NOW()
         RETURNING t.client_user_id`,
        [tokenHash],
      );
      if (result.rowCount !== 1) return null;
      const clientUserId = result.rows[0].client_user_id;
      await client.query(
        `UPDATE client_users SET email_verified_at = COALESCE(email_verified_at, NOW()),
           updated_at = NOW() WHERE id = $1 AND status = 'active'`,
        [clientUserId],
      );
      return { clientUserId };
    });
  }

  async createEmailVerification(
    clientUserId: string,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void> {
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE client_email_verification_tokens
         SET status = 'revoked', revoked_at = NOW()
         WHERE client_user_id = $1 AND status = 'pending'`,
        [clientUserId],
      );
      await client.query(
        `INSERT INTO client_email_verification_tokens
          (id, client_user_id, token_hash, status, expires_at, created_at)
         VALUES ($1, $2, $3, 'pending', $4, NOW())`,
        [clientId("client_verification"), clientUserId, tokenHash, expiresAt],
      );
    });
  }

  async createSession(input: {
    clientUserId: string;
    tokenHash: string;
    expiresAt: string;
    userAgentHash: string | null;
    ipHash: string | null;
  }): Promise<void> {
    await db.query(
      `INSERT INTO client_sessions
        (id, token_hash, client_user_id, created_at, expires_at, last_used_at,
         user_agent_hash, ip_hash)
       SELECT $6, $1, cu.id, NOW(), $3, NOW(), $4, $5
       FROM client_users cu
       WHERE cu.id = $2 AND cu.status = 'active' AND cu.email_verified_at IS NOT NULL
      `,
      [
        input.tokenHash,
        input.clientUserId,
        input.expiresAt,
        input.userAgentHash,
        input.ipHash,
        clientId("client_session"),
      ],
    );
  }

  async getSessionAccount(tokenHash: string): Promise<ClientSessionAccount | null> {
    const rows = await db.query(
      `UPDATE client_sessions s
       SET last_used_at = NOW()
       FROM client_users cu
       WHERE s.token_hash = $1 AND s.client_user_id = cu.id
         AND s.revoked_at IS NULL AND s.expires_at > NOW()
         AND cu.status = 'active' AND cu.email_verified_at IS NOT NULL
       RETURNING cu.id, cu.name, cu.email, cu.status, cu.email_verified_at`,
      [tokenHash],
    );
    if (!rows[0]) return null;
    return {
      client: {
        id: rows[0].id,
        name: rows[0].name,
        email: rows[0].email,
        status: rows[0].status,
        emailVerified: Boolean(rows[0].email_verified_at),
      },
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await db.query(
      `UPDATE client_sessions SET revoked_at = NOW(), revoked_reason = 'logout'
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }

  async listSessions(clientUserId: string, currentTokenHash: string): Promise<any[]> {
    return db.query(
      `SELECT id, token_hash = $2 AS current, created_at, expires_at, last_used_at,
         revoked_at, user_agent_hash
       FROM client_sessions
       WHERE client_user_id = $1
       ORDER BY created_at DESC`,
      [clientUserId, currentTokenHash],
    );
  }

  async revokeSession(clientUserId: string, sessionId: string): Promise<boolean> {
    const rows = await db.query(
      `UPDATE client_sessions
       SET revoked_at = NOW(), revoked_reason = 'remote_revocation'
       WHERE id = $1 AND client_user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [sessionId, clientUserId],
    );
    return rows.length === 1;
  }

  async createPasswordReset(
    clientUserId: string,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void> {
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE client_password_reset_tokens
         SET status = 'revoked', revoked_at = NOW()
         WHERE client_user_id = $1 AND status = 'pending'`,
        [clientUserId],
      );
      await client.query(
        `INSERT INTO client_password_reset_tokens
          (id, client_user_id, token_hash, status, expires_at, created_at)
         VALUES ($1, $2, $3, 'pending', $4, NOW())`,
        [clientId("client_reset"), clientUserId, tokenHash, expiresAt],
      );
    });
  }

  async resetPassword(
    tokenHash: string,
    passwordHash: string,
  ): Promise<{ clientUserId: string; email: string; name: string } | null> {
    return db.transaction(async (client) => {
      const reset = await client.query(
        `UPDATE client_password_reset_tokens
         SET status = 'used', used_at = NOW()
         WHERE token_hash = $1 AND status = 'pending' AND expires_at > NOW()
         RETURNING client_user_id`,
        [tokenHash],
      );
      if (reset.rowCount !== 1) return null;
      await client.query(
        `UPDATE client_users SET password_hash = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'active'`,
        [reset.rows[0].client_user_id, passwordHash],
      );
      await client.query(
        `UPDATE client_sessions SET revoked_at = NOW(), revoked_reason = 'password_reset'
         WHERE client_user_id = $1 AND revoked_at IS NULL`,
        [reset.rows[0].client_user_id],
      );
      const account = await client.query(
        `SELECT id, email, name FROM client_users WHERE id = $1`,
        [reset.rows[0].client_user_id],
      );
      return account.rowCount === 1 ? {
        clientUserId: account.rows[0].id,
        email: account.rows[0].email,
        name: account.rows[0].name,
      } : null;
    });
  }

  async getDashboard(clientUserId: string): Promise<any> {
    const accessStatuses = await db.query(
      `SELECT m.status, c.name AS matter_name, m.updated_at
       FROM matter_client_memberships m
       JOIN cases c ON c.id = m.case_id AND c.firm_id = m.firm_id
       WHERE m.client_user_id = $1
       ORDER BY m.updated_at DESC`,
      [clientUserId],
    );
    const matters = await db.query(
      `SELECT c.id, c.name, c.description, c.status, c.updated_at, f.name AS firm_name,
         m.id AS membership_id
       FROM matter_client_memberships m
       JOIN cases c ON c.id = m.case_id AND c.firm_id = m.firm_id
       JOIN firm f ON f.id = m.firm_id
       JOIN client_users cu ON cu.id = m.client_user_id
       WHERE m.client_user_id = $1 AND m.status = 'active'
         AND cu.status = 'active' AND c.lifecycle_state <> 'deleted'
       ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC`,
      [clientUserId],
    );
    const matterIds = matters.map((matter) => matter.id);
    if (!matterIds.length) {
      return {
        matters: [],
        sharedDocuments: [],
        requests: [],
        comments: [],
        activity: [],
        notifications: [],
        accessState: accessStatuses.some((item) => item.status === "suspended")
          ? "suspended" : accessStatuses.some((item) => item.status === "removed")
            ? "removed" : "empty",
      };
    }
    const [sharedDocuments, requests, comments, activity, notifications] = await Promise.all([
      db.query(
        `SELECT d.id, d.case_id, d.title, d.content, d.updated_at, d.origin,
           d.revision_type, d.parent_draft_id, d.created_by_client_user_id,
           d.client_visibility
         FROM drafts d
         JOIN cases c ON c.id = d.case_id
         JOIN matter_client_memberships m
           ON m.case_id = c.id AND m.firm_id = c.firm_id
         WHERE m.client_user_id = $1 AND m.status = 'active'
           AND d.case_id = ANY($2::text[]) AND d.lifecycle_state = 'active'
           AND (
             d.shared_with_client = TRUE
             OR d.created_by_client_user_id = $1
             OR (d.client_visibility = 'shared' AND d.revision_type IN ('Client Revision', 'Client Response'))
           )
         ORDER BY COALESCE(d.updated_at, d.created_at) DESC`,
        [clientUserId, matterIds],
      ),
      db.query(
        `SELECT r.id, r.case_id, r.request_type, r.instruction, r.status,
           r.created_at, r.updated_at,
           COALESCE(JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('id', d.id, 'title', d.title))
             FILTER (WHERE d.id IS NOT NULL), '[]'::jsonb) AS documents,
           COALESCE(JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
             'id', cr.id, 'response_type', cr.response_type, 'content', cr.content,
             'created_at', cr.created_at, 'client_user_id', cr.client_user_id
           )) FILTER (
             WHERE cr.id IS NOT NULL
               AND (cr.client_user_id IS NULL OR cr.client_user_id = $1 OR cr.visibility = 'shared')
           ), '[]'::jsonb) AS responses
         FROM collaboration_requests r
         JOIN cases c ON c.id = r.case_id
         JOIN matter_client_memberships m
           ON m.case_id = c.id AND m.firm_id = c.firm_id
         LEFT JOIN collaboration_request_documents rd ON rd.request_id = r.id
         LEFT JOIN drafts d ON d.id = rd.draft_id AND d.case_id = r.case_id
         LEFT JOIN client_responses cr ON cr.request_id = r.id
         WHERE m.client_user_id = $1 AND m.status = 'active'
           AND r.case_id = ANY($2::text[])
         GROUP BY r.id ORDER BY r.created_at DESC`,
        [clientUserId, matterIds],
      ),
      db.query(
        `SELECT cc.id, cc.case_id, cc.draft_id, cc.content, cc.created_at,
           cc.client_user_id, cc.visibility
         FROM client_account_comments cc
         JOIN matter_client_memberships m
           ON m.case_id = cc.case_id AND m.firm_id = cc.firm_id
         WHERE m.client_user_id = $1 AND m.status = 'active'
           AND cc.case_id = ANY($2::text[])
           AND (cc.client_user_id = $1 OR cc.visibility = 'shared')
         ORDER BY cc.created_at DESC`,
        [clientUserId, matterIds],
      ),
      db.query(
        `SELECT a.id, a.case_id, a.activity_type, a.resource_type, a.resource_id,
           a.summary, a.visibility, a.created_at
         FROM client_activity_records a
         JOIN matter_client_memberships m
           ON m.case_id = a.case_id AND m.firm_id = a.firm_id
         WHERE m.client_user_id = $1 AND m.status = 'active'
           AND a.case_id = ANY($2::text[])
           AND (a.client_user_id = $1 OR a.visibility = 'shared')
         ORDER BY a.created_at DESC LIMIT 100`,
        [clientUserId, matterIds],
      ),
      db.query(
        `SELECT n.id, n.case_id, n.notification_type, n.title, n.deep_link,
           n.read_at, n.created_at
         FROM client_notifications n
         WHERE n.recipient_client_user_id = $1
         ORDER BY n.created_at DESC LIMIT 100`,
        [clientUserId],
      ),
    ]);
    return {
      matters,
      sharedDocuments,
      requests,
      comments,
      activity,
      notifications,
      accessState: "active",
    };
  }

  async getAuthorizedDraft(
    clientUserId: string,
    caseId: string,
    draftId: string,
  ): Promise<any | null> {
    const rows = await db.query(
      `SELECT d.id, d.case_id, d.title, d.content, d.updated_at, d.origin,
         d.revision_type, d.parent_draft_id
       FROM drafts d
       JOIN cases c ON c.id = d.case_id
       JOIN matter_client_memberships m
         ON m.case_id = c.id AND m.firm_id = c.firm_id
       JOIN client_users cu ON cu.id = m.client_user_id
       WHERE m.client_user_id = $1 AND m.status = 'active'
         AND cu.status = 'active' AND d.case_id = $2 AND d.id = $3
         AND d.lifecycle_state = 'active'
         AND (
           d.shared_with_client = TRUE
           OR d.created_by_client_user_id = $1
           OR (d.client_visibility = 'shared'
             AND d.revision_type IN ('Client Revision', 'Client Response'))
         )`,
      [clientUserId, caseId, draftId],
    );
    return rows[0] || null;
  }

  private async getActiveMembership(
    client: pg.PoolClient,
    clientUserId: string,
    caseId: string,
  ): Promise<any | null> {
    const result = await client.query(
      `SELECT m.id, m.firm_id, m.case_id
       FROM matter_client_memberships m
       JOIN cases c ON c.id = m.case_id AND c.firm_id = m.firm_id
       JOIN client_users cu ON cu.id = m.client_user_id
       WHERE m.client_user_id = $1 AND m.case_id = $2
         AND m.status = 'active' AND cu.status = 'active'
       FOR UPDATE OF m`,
      [clientUserId, caseId],
    );
    return result.rows[0] || null;
  }

  async createResponse(input: {
    clientUserId: string;
    caseId: string;
    requestId: string;
    content: string;
  }): Promise<any> {
    return db.transaction(async (client) => {
      const membership = await this.getActiveMembership(client, input.clientUserId, input.caseId);
      if (!membership) throw new Error("Matter access is unavailable");
      const request = await client.query(
        `SELECT r.id FROM collaboration_requests r
         JOIN cases c ON c.id = r.case_id
         WHERE r.id = $1 AND r.case_id = $2 AND c.firm_id = $3
         FOR UPDATE OF r`,
        [input.requestId, input.caseId, membership.firm_id],
      );
      if (request.rowCount !== 1) throw new Error("Request not found");
      const id = clientId("client_response");
      const result = await client.query(
        `INSERT INTO client_responses
          (id, request_id, response_type, content, is_read, created_at,
           client_user_id, client_membership_id, visibility)
         VALUES ($1, $2, 'Comment', $3, FALSE, NOW(), $4, $5, 'private')
         RETURNING *`,
        [id, input.requestId, input.content, input.clientUserId, membership.id],
      );
      await client.query(
        `UPDATE collaboration_requests SET status = 'Responded', updated_at = NOW()
         WHERE id = $1 AND case_id = $2`,
        [input.requestId, input.caseId],
      );
      await client.query(
        `INSERT INTO client_activity_records
          (id, firm_id, case_id, client_user_id, membership_id, activity_type,
           resource_type, resource_id, visibility, summary, created_at)
         VALUES ($1, $2, $3, $4, $5, 'client_response',
           'response', $6, 'private', 'Client responded to a lawyer request', NOW())`,
        [clientId("client_activity"), membership.firm_id, input.caseId,
          input.clientUserId, membership.id, id],
      );
      await notifyLawyers(client, {
        firmId: membership.firm_id,
        caseId: input.caseId,
        actorClientUserId: input.clientUserId,
        type: "client_response",
        title: "A client responded to a request",
      });
      return result.rows[0];
    });
  }

  async createComment(input: {
    clientUserId: string;
    caseId: string;
    draftId: string;
    content: string;
  }): Promise<any> {
    return db.transaction(async (client) => {
      const membership = await this.getActiveMembership(client, input.clientUserId, input.caseId);
      if (!membership) throw new Error("Matter access is unavailable");
      const draft = await client.query(
        `SELECT d.id FROM drafts d JOIN cases c ON c.id = d.case_id
         WHERE d.id = $1 AND d.case_id = $2 AND c.firm_id = $3
           AND (
             d.shared_with_client = TRUE OR d.created_by_client_user_id = $4
             OR d.client_visibility = 'shared'
           )`,
        [input.draftId, input.caseId, membership.firm_id, input.clientUserId],
      );
      if (draft.rowCount !== 1) throw new Error("Shared Work Product not found");
      const id = clientId("client_comment");
      const result = await client.query(
        `INSERT INTO client_account_comments
          (id, firm_id, case_id, draft_id, client_user_id, membership_id,
           content, visibility, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'private', NOW())
         RETURNING *`,
        [id, membership.firm_id, input.caseId, input.draftId,
          input.clientUserId, membership.id, input.content],
      );
      await client.query(
        `INSERT INTO client_activity_records
          (id, firm_id, case_id, client_user_id, membership_id, activity_type,
           resource_type, resource_id, visibility, summary, created_at)
         VALUES ($1, $2, $3, $4, $5, 'client_comment',
           'comment', $6, 'private', 'Client commented on shared Work Product', NOW())`,
        [clientId("client_activity"), membership.firm_id, input.caseId,
          input.clientUserId, membership.id, id],
      );
      await notifyLawyers(client, {
        firmId: membership.firm_id,
        caseId: input.caseId,
        actorClientUserId: input.clientUserId,
        type: "client_comment",
        title: "A client left a comment",
      });
      return result.rows[0];
    });
  }

  async createRevision(input: {
    clientUserId: string;
    caseId: string;
    draftId: string;
    content: string;
  }): Promise<any> {
    return db.transaction(async (client) => {
      const membership = await this.getActiveMembership(client, input.clientUserId, input.caseId);
      if (!membership) throw new Error("Matter access is unavailable");
      const original = await client.query(
        `SELECT d.id, d.title, c.created_by_user_id
         FROM drafts d JOIN cases c ON c.id = d.case_id
         WHERE d.id = $1 AND d.case_id = $2 AND c.firm_id = $3
           AND d.shared_with_client = TRUE`,
        [input.draftId, input.caseId, membership.firm_id],
      );
      if (original.rowCount !== 1 || !original.rows[0].created_by_user_id) {
        throw new Error("Shared Work Product not found");
      }
      const id = clientId("draft");
      const now = new Date().toISOString();
      const revision = await client.query(
        `INSERT INTO drafts
          (id, thread_id, case_id, title, content, created_at, updated_at, origin,
           parent_draft_id, revision_type, shared_with_client,
           created_by_client_user_id, client_membership_id, client_visibility)
         VALUES ($1, NULL, $2, $3, $4, $5, $5, 'Client Account',
           $6, 'Client Revision', FALSE, $7, $8, 'private')
         RETURNING *`,
        [id, input.caseId, `Client Revision — ${original.rows[0].title}`,
          input.content, now, input.draftId, input.clientUserId, membership.id],
      );
      await client.query(
        `INSERT INTO work_product_versions
          (id, firm_id, case_id, draft_id, version_number, title, content,
           revision_lane, change_type, created_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, 1, $5, $6, 'client', 'created', $7, $8)`,
        [clientId("work_product_version"), membership.firm_id, input.caseId, id,
          revision.rows[0].title, input.content, original.rows[0].created_by_user_id, now],
      );
      await client.query(
        `INSERT INTO client_activity_records
          (id, firm_id, case_id, client_user_id, membership_id, activity_type,
           resource_type, resource_id, visibility, summary, created_at)
         VALUES ($1, $2, $3, $4, $5, 'client_revision',
           'draft', $6, 'private', 'Client created a Work Product revision', NOW())`,
        [clientId("client_activity"), membership.firm_id, input.caseId,
          input.clientUserId, membership.id, id],
      );
      await notifyLawyers(client, {
        firmId: membership.firm_id,
        caseId: input.caseId,
        actorClientUserId: input.clientUserId,
        type: "client_revision",
        title: "A client created a revision",
      });
      return revision.rows[0];
    });
  }

  async listLawyerNotifications(context: OwnershipContext): Promise<any> {
    const items = await db.query(
      `SELECT n.id, n.case_id, n.notification_type, n.title, n.deep_link,
         n.read_at, n.created_at, cu.name AS actor_name
       FROM client_notifications n
       LEFT JOIN client_users cu ON cu.id = n.actor_client_user_id
       WHERE n.firm_id = $1 AND n.recipient_user_id = $2
       ORDER BY n.created_at DESC LIMIT 100`,
      [context.firmId, context.userId],
    );
    return { items, unread: items.filter((item) => !item.read_at).length };
  }

  async markLawyerNotificationRead(
    context: OwnershipContext,
    notificationId: string,
  ): Promise<boolean> {
    const rows = await db.query(
      `UPDATE client_notifications SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND firm_id = $2 AND recipient_user_id = $3
       RETURNING id`,
      [notificationId, context.firmId, context.userId],
    );
    return rows.length === 1;
  }

  async markAllLawyerNotificationsRead(context: OwnershipContext): Promise<void> {
    await db.query(
      `UPDATE client_notifications SET read_at = COALESCE(read_at, NOW())
       WHERE firm_id = $1 AND recipient_user_id = $2 AND read_at IS NULL`,
      [context.firmId, context.userId],
    );
  }

  async markClientNotificationRead(
    clientUserId: string,
    notificationId: string,
  ): Promise<boolean> {
    const rows = await db.query(
      `UPDATE client_notifications SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND recipient_client_user_id = $2
       RETURNING id`,
      [notificationId, clientUserId],
    );
    return rows.length === 1;
  }

  async markAllClientNotificationsRead(clientUserId: string): Promise<void> {
    await db.query(
      `UPDATE client_notifications SET read_at = COALESCE(read_at, NOW())
       WHERE recipient_client_user_id = $1 AND read_at IS NULL`,
      [clientUserId],
    );
  }

  async getNotificationPreferences(
    recipientKind: "lawyer" | "client",
    recipientId: string,
  ): Promise<any> {
    const rows = await db.query(
      `SELECT in_app_enabled, email_enabled, security_email_enabled
       FROM notification_preferences
       WHERE recipient_kind = $1 AND recipient_id = $2`,
      [recipientKind, recipientId],
    );
    return rows[0] || {
      in_app_enabled: true,
      email_enabled: true,
      security_email_enabled: true,
    };
  }

  async setNotificationPreferences(
    recipientKind: "lawyer" | "client",
    recipientId: string,
    input: { inAppEnabled: boolean; emailEnabled: boolean },
  ): Promise<any> {
    const rows = await db.query(
      `INSERT INTO notification_preferences
        (id, recipient_kind, recipient_id, in_app_enabled, email_enabled,
         security_email_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
       ON CONFLICT (recipient_kind, recipient_id) DO UPDATE
         SET in_app_enabled = EXCLUDED.in_app_enabled,
           email_enabled = EXCLUDED.email_enabled,
           updated_at = NOW()
       RETURNING in_app_enabled, email_enabled, security_email_enabled`,
      [clientId("notification_preferences"), recipientKind, recipientId,
        input.inAppEnabled, input.emailEnabled],
    );
    return rows[0];
  }

  async setMembershipStatus(input: {
    context: OwnershipContext;
    caseId: string;
    membershipId: string;
    status: "active" | "suspended" | "removed";
  }): Promise<boolean> {
    return db.transaction(async (client) => {
      const changed = await client.query(
        `UPDATE matter_client_memberships m
         SET status = $1,
           suspended_at = CASE WHEN $1 = 'suspended' THEN NOW() ELSE suspended_at END,
           removed_at = CASE WHEN $1 = 'removed' THEN NOW() ELSE removed_at END,
           updated_at = NOW()
         FROM cases c
         WHERE m.id = $2 AND m.case_id = $3 AND m.firm_id = $4
           AND c.id = m.case_id AND c.firm_id = m.firm_id
         RETURNING m.client_user_id`,
        [input.status, input.membershipId, input.caseId, input.context.firmId],
      );
      if (changed.rowCount !== 1) return false;
      await client.query(
        `INSERT INTO client_notifications
          (id, firm_id, case_id, recipient_client_user_id, actor_user_id,
           notification_type, title, deep_link, created_at)
         VALUES ($1, $2, $3, $4, $5, 'access_changed', $6,
           '/client/dashboard?matter=' || $3, NOW())`,
        [clientId("notification"), input.context.firmId, input.caseId,
          changed.rows[0].client_user_id, input.context.userId,
          input.status === "active" ? "Your Matter access was restored"
            : input.status === "suspended" ? "Your Matter access was suspended"
              : "Your Matter access was removed"],
      );
      return true;
    });
  }

  async recordEmailDelivery(record: EmailDeliveryRecord): Promise<void> {
    await db.query(
      `INSERT INTO email_delivery_attempts
        (id, firm_id, client_user_id, template_key, recipient_email_hash,
         provider, provider_message_id, status, attempt_count, failure_category,
         created_at, attempted_at, delivered_at, failed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         NOW(), NOW(), $11, $12)`,
      [record.id, record.firmId, record.clientUserId, record.templateKey,
        record.recipientEmailHash, record.provider, record.providerMessageId,
        record.status, record.attemptCount, record.failureCategory,
        record.deliveredAt, record.failedAt],
    );
  }
}

export const clientRepository = new ClientRepository();
