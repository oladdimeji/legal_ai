import net from "node:net";
import type { MalwareScanningProvider, ProviderHealth } from "./providers/contracts.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export class ClamAvScanner implements MalwareScanningProvider {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  private exchange(chunks: Uint8Array[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const replies: Buffer[] = [];
      const fail = () => {
        socket.destroy();
        reject(new Error("Malware scanner unavailable."));
      };
      socket.setTimeout(this.timeoutMs, fail);
      socket.once("error", fail);
      socket.on("data", (value) => replies.push(value));
      socket.once("end", () => resolve(Buffer.concat(replies).toString("utf8")));
      socket.once("connect", () => {
        for (const chunk of chunks) socket.write(chunk);
        socket.end();
      });
    });
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await this.exchange([Buffer.from("zPING\0")]);
      return response.includes("PONG") ? { status: "ready" } : { status: "unavailable" };
    } catch {
      return { status: "unavailable", detail: "Malware scanner unavailable" };
    }
  }

  async scan(content: Uint8Array): Promise<"clean" | "infected"> {
    const frames: Uint8Array[] = [Buffer.from("zINSTREAM\0")];
    for (let offset = 0; offset < content.length; offset += 64 * 1024) {
      const part = content.subarray(offset, Math.min(offset + 64 * 1024, content.length));
      const size = Buffer.alloc(4);
      size.writeUInt32BE(part.length);
      frames.push(size, part);
    }
    frames.push(Buffer.alloc(4));
    const response = await this.exchange(frames);
    if (response.includes(" FOUND")) return "infected";
    if (response.includes(" OK")) return "clean";
    throw new Error("Malware scanner returned an invalid response.");
  }
}
