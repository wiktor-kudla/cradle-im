// import * as I2PClient from 'i2p-client';
let I2PClient: any;

class I2PProxy {
  private i2p_client: typeof I2PClient;
  private destination: any;
  private proxy_server: any;

  constructor() {
    this.i2p_client = new I2PClient();
    this.destination = null;
    this.proxy_server = null;
  }

  async create_i2p_destination() {
    try {
      this.destination = await this.i2p_client.createDestination();
      console.log(`I2P destination created: ${this.destination.b32}`);
    } catch (error) {
      console.error('Error creating I2P destination:', error);
    }
  }

  async start_proxy_server(port: number) {
    const http = require('http');
    this.proxy_server = http.createServer((req: any, res: any) => {
      console.log(JSON.stringify(req.params));
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello, cradle.im Server!\n');
    });

    this.proxy_server.listen(port, () => {
      console.log(`Proxy server started on port ${port}`);
    });
  }

  async route_through_i2p_tunnel(target: string) {
    try {
      if (!this.destination) {
        console.error('I2P destination is not created yet.');
        return;
      }

      const tunnel = await this.i2p_client.createTunnel(target, this.destination.b32);
      console.log(`I2P tunnel to ${target} created: ${tunnel.tunnelId}`);
    } catch (error) {
      console.error('Error creating I2P tunnel:', error);
    }
  }

  async stop_proxy_server() {
    if (this.proxy_server) {
      this.proxy_server.close(() => {
        console.log('Proxy server stopped.');
      });
    }
  }
}

async function i2p_proxy_main() {
  const proxy = new I2PProxy();

  await proxy.create_i2p_destination();

  proxy.start_proxy_server(8080);

  await proxy.route_through_i2p_tunnel('http://cradle-im.i2p');

  proxy.stop_proxy_server();
}

i2p_proxy_main().catch((error) => {
  console.error('An error occurred:', error);
});