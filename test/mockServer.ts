import net from 'net';

export class MockRCONServer {
  private server: net.Server;
  public lastCommand = '';

  constructor(private port: number) {
    this.server = net.createServer(this.handleConnection.bind(this));
  }

  start(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.port, resolve));
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private handleConnection(socket: net.Socket) {
    socket.on('data', (data) => {
      const packetLength = data.readInt32LE(0);
      const requestId = data.readInt32LE(4);
      const type = data.readInt32LE(8);
      const body = data.toString('utf8', 12, packetLength + 2);

      if (type === 3) {
        const response = this.buildPacket(requestId, 2, '');
        socket.write(response);
      } else if (type === 2) {
        this.lastCommand = body;
        const response = this.buildPacket(requestId, 0, `Executed: ${body}`);
        socket.write(response);
      }
    });
  }

  private buildPacket(id: number, type: number, body: string): Buffer {
    const bodyBuffer = Buffer.from(body + '\x00\x00', 'utf8');
    const length = 4 + 4 + bodyBuffer.length;
    const buf = Buffer.alloc(4 + length);

    buf.writeInt32LE(length, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    bodyBuffer.copy(buf, 12);

    return buf;
  }
}