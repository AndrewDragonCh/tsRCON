import { RCONClient } from '../src';
import { MockRCONServer } from './mockServer';

const PORT = 27015;
const HOST = '127.0.0.1';

describe('RCONClient', () => {
  let server: MockRCONServer;

  beforeAll(async () => {
    server = new MockRCONServer(PORT);
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should connect and authenticate successfully', async () => {
    const client = new RCONClient(HOST, PORT, 'password');
    await expect(client.connect()).resolves.toBeUndefined();
    client.disconnect();
  });

  it('should ping the server successfully', async () => {
    const client = new RCONClient(HOST, PORT, 'password');
    await client.connect();
    const alive = await client.ping();
    expect(alive).toBe(true);
    client.disconnect();
  });


  it('should send command and receive response', async () => {
    const client = new RCONClient(HOST, PORT, 'password');
    await client.connect();
    const resp = await client.sendCommand('say hello');
    expect(resp).toBe('Executed: say hello');
    client.disconnect();
  });
});
