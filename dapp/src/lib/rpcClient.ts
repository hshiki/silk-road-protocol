import { SuiGrpcClient } from '@mysten/sui/grpc';

export const rpcClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

const RPC_URL = 'https://fullnode.testnet.sui.io:443';

async function rpcCall(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export const suiClient = {
  getCoins: (params: { owner: string; coinType: string }) =>
    rpcCall('suix_getCoins', [params.owner, params.coinType]),
  getCoinMetadata: (params: { coinType: string }) =>
    rpcCall('suix_getCoinMetadata', [params.coinType]),
  getOwnedObjects: (params: { owner: string; filter?: unknown; options?: unknown }) =>
    rpcCall('suix_getOwnedObjects', [params.owner, { filter: params.filter, options: params.options ?? {} }]),
  getObject: (params: { objectId: string; options?: unknown }) =>
    rpcCall('sui_getObject', [params.objectId, params.options ?? { showOwner: true }]),
  queryEvents: (params: { query: unknown; limit?: number }) =>
    rpcCall('suix_queryEvents', [params.query, null, params.limit ?? 50, false]),
  getDynamicFieldObject: (params: { parentId: string; name: { type: string; value: unknown } }) =>
    rpcCall('suix_getDynamicFieldObject', [params.parentId, params.name]),
};
