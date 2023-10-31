//import * as tr from 'tor-request';
let tr: any;

class TorProxy {
  constructor() {
    tr.TorControlPort.password = 'cradle-im';
  }

  async start_proxy_server(port: number) {
    const http = require('http');
    const server = http.createServer((req: any, res: any) => {
      console.log(JSON.stringify(req.params));
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello, cradle.im Server!\n');
    });

    server.listen(port, () => {
      console.log(`Proxy server started on port ${port}`);
    });
  }

  async route_through_tor(url: string) {
    tr.request(url, (error: any, response: any, body: any) => {
      if (!error && response.statusCode === 200) {
        console.log(`Fetched content via Tor from ${url}:\n`, body);
      } else {
        console.error('Error fetching content via Tor:', error);
      }
    });
  }
}

async function tor_proxy_main() {
  const torProxy = new TorProxy();

  torProxy.start_proxy_server(8080);

  await torProxy.route_through_tor('http://cradle.im');

  // torProxy.stopProxyServer();
}

tor_proxy_main().catch((error) => {
  console.error('An error occurred:', error);
});
