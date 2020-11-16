import { Ethereum } from '@renproject/chains'
import { RenNetwork } from '@renproject/interfaces'
import { BridgeChain } from '../../utils/assetConfigs'

export const bridgeChainToMultiwalletChain = (chainSymbol: BridgeChain) => {
  switch (chainSymbol) {
    case BridgeChain.BTCC:
      return "bitcoin";
    case BridgeChain.BNCC:
      return "bsc";
    case BridgeChain.ETHC:
      return "ethereum";
    default:
      return "unknown";
  }
};
export const multiwalletChainToBridgeChain = (chain: string) => {
  switch (chain) {
    case "bitcoin":
      return BridgeChain.BTCC;
    case "bsc":
      return BridgeChain.BNCC;
    case "ethereum":
      return BridgeChain.ETHC;
    default:
      return BridgeChain.UNKNOWNC;
  }
};

export const fetchAssetBalance = (
  provider: any,
  account: string,
  asset: string
) => {
  const chain = Ethereum(provider, RenNetwork.Testnet);
  return chain.getBalance(asset, account).then((balance) => {
    console.log("balance", balance.toNumber());
    return balance.toNumber() / 100000000;
  });
};
