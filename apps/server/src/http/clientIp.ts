import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

// https://www.cloudflare.com/ips/
const CLOUDFLARE = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE) {
  const [network, bits] = range.split('/');
  cloudflare.addSubnet(network, Number(bits), network.includes(':') ? 'ipv6' : 'ipv4');
}

export function isCloudflare(ip: string): boolean {
  const plain = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  const family = isIP(plain);
  if (family === 4) return cloudflare.check(plain, 'ipv4');
  if (family === 6) return cloudflare.check(plain, 'ipv6');
  return false;
}

// The visitor's own address. Through Cloudflare request.ip is a Cloudflare edge that many families share,
// so CF-Connecting-IP counts instead, but only when the request really came from Cloudflare.
export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['cf-connecting-ip'];
  if (typeof forwarded === 'string' && isIP(forwarded) && isCloudflare(request.ip)) return forwarded;
  return request.ip;
}
