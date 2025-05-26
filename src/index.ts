import { Socket } from 'net';
import { randomInt } from 'crypto';

enum RCONPacketType {
  RESPONSE_VALUE = 0,
  COMMAND = 2,
  AUTH = 3,
  AUTH_RESPONSE = 2,
}

type PacketResponse = {
  resolve: (resp: string) => void;
  reject: (err: Error) => void;
  buffer: string[];
  timeout?: NodeJS.Timeout;
};

export class RCONClient {
  private socket: Socket;
  private buffer = Buffer.alloc(0);
  private authenticated = false;
  private callbacks: Map<number, PacketResponse> = new Map();
  private options: {
    timeout: number;
    retries: number;
  };

  constructor(
    private host: string,
    private port: number,
    private password: string,
    opts?: Partial<{ timeout: number; retries: number }>
  ) {
    this.socket = new Socket();
    this.options = {
      timeout: opts?.timeout ?? 3000,
      retries: opts?.retries ?? 1,
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.connect(this.port, this.host, async () => {
        this.socket.on('data', this.handleData.bind(this));
        this.socket.on('error', (err) => {
          for (const cb of this.callbacks.values()) {
            cb.reject(err);
          }
        });

        try {
          await this.authenticate();
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      this.socket.on('error', reject);
    });
  }

  disconnect() {
    this.socket.end();
  }

  private handleData(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 4) {
      const packetLength = this.buffer.readInt32LE(0);
      if (this.buffer.length < packetLength + 4) return;

      const packet = this.buffer.subarray(4, 4 + packetLength);
      const requestId = packet.readInt32LE(0);
      const type = packet.readInt32LE(4);
      const body = packet.toString('utf8', 8, packet.length - 2);

      this.buffer = this.buffer.subarray(4 + packetLength);

      const cb = this.callbacks.get(requestId);
      if (!cb) continue;

      if (type === RCONPacketType.AUTH_RESPONSE && requestId === -1) {
        cb.reject(new Error('Authentication failed'));
        this.callbacks.delete(requestId);
        continue;
      }

      cb.buffer.push(body);

      clearTimeout(cb.timeout);
      cb.timeout = setTimeout(() => {
        cb.resolve(cb.buffer.join(''));
        this.callbacks.delete(requestId);
      }, 10);
    }
  }

  private sendPacket(type: RCONPacketType, body: string): Promise<string> {
    const requestId = randomInt(1, 0x7fffffff);
    const payload = Buffer.from(body + '\x00', 'utf8');
    const size = 4 + 4 + payload.length + 1;

    const buf = Buffer.alloc(4 + size);
    buf.writeInt32LE(size, 0);
    buf.writeInt32LE(requestId, 4);
    buf.writeInt32LE(type, 8);
    payload.copy(buf, 12);
    buf.writeUInt8(0, 12 + payload.length);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.callbacks.delete(requestId);
        reject(new Error('RCON request timed out'));
      }, this.options.timeout);

      this.callbacks.set(requestId, {
        resolve,
        reject,
        buffer: [],
        timeout,
      });

      this.socket.write(buf);
    });
  }

  private async authenticate(): Promise<void> {
    for (let attempt = 1; attempt <= this.options.retries + 1; attempt++) {
      try {
        await this.sendPacket(RCONPacketType.AUTH, this.password);
        this.authenticated = true;
        return;
      } catch (err) {
        if (attempt > this.options.retries) throw err;
      }
    }
  }

  async sendCommand(command: string): Promise<string> {
    if (!this.authenticated) throw new Error('Not authenticated');
    for (let attempt = 1; attempt <= this.options.retries + 1; attempt++) {
      try {
        return await this.sendPacket(RCONPacketType.COMMAND, command);
      } catch (err) {
        if (attempt > this.options.retries) throw err;
      }
    }
    throw new Error('All retries failed');
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.sendCommand('list');
      return !!result;
    } catch {
      return false;
    }
  }
}