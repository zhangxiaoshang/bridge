import { Gateway, GatewayTransaction } from "@renproject/ren";
import { ChainTransactionStatus } from "@renproject/utils";
import React, {
  FunctionComponent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { RouteComponentProps } from "react-router";
import { useHistory } from "react-router-dom";
import {
  ActionButton,
  ActionButtonWrapper,
} from "../../../../components/buttons/Buttons";
import { MediumTopWrapper } from "../../../../components/layout/LayoutHelpers";
import { PaperContent } from "../../../../components/layout/Paper";
import { Debug } from "../../../../components/utils/Debug";
import { paths } from "../../../../pages/routes";
import { useNotifications } from "../../../../providers/Notifications";
import { trimAddress } from "../../../../utils/strings";
import {
  alterContractChainProviderSigner,
  pickChains,
} from "../../../chain/chainUtils";
import { useCurrentNetworkChains } from "../../../network/networkHooks";
import { LocalTxPersistor, useTxsStorage } from "../../../storage/storageHooks";
import {
  GeneralErrorDialog,
  SubmitErrorDialog,
} from "../../../transactions/components/TransactionsHelpers";
import { AddressInfo } from "../../../transactions/components/TransactionsHistoryHelpers";
import { useSetCurrentTxHash } from "../../../transactions/transactionsHooks";
import { useSyncWalletChain, useWallet } from "../../../wallet/walletHooks";
import { $wallet } from "../../../wallet/walletSlice";
import { BalanceInfoPlaceholder } from "../../components/BalanceHelpers";
import { FeesToggler } from "../../components/FeeHelpers";
import { GatewayFees } from "../../components/GatewayFees";
import { GatewayLoaderStatus } from "../../components/GatewayHelpers";
import { PCW } from "../../components/PaperHelpers";
import {
  getGatewayParams,
  useChainInstanceAssetDecimals,
  useGateway,
  useGatewayFeesWithRates,
} from "../../gatewayHooks";
import {
  isTxSubmittable,
  useChainTransactionStatusUpdater,
  useChainTransactionSubmitter,
  useRenVMChainTransactionStatusUpdater,
} from "../../gatewayTransactionHooks";
import { parseGatewayQueryString } from "../../gatewayUtils";
import {
  GatewayPaperHeader,
  TransactionRecoveryModal,
} from "../shared/GatewayNavigationHelpers";
import { SendingReceivingSection } from "../shared/TransactionStatuses";
import {
  H2HAccountsResolver,
  SwitchWalletDialog,
} from "../shared/WalletSwitchHelpers";
import {
  MintH2HCompletedStatus,
  MintH2HLockTransactionProgressStatus,
  MintH2HMintTransactionProgressStatus,
} from "./MintH2HStatuses";

export const MintH2HProcess: FunctionComponent<RouteComponentProps> = ({
  location,
  ...rest
}) => {
  const { gatewayParams, additionalParams } = parseGatewayQueryString(
    location.search
  );
  const { from, to, toAddress } = gatewayParams;
  const { renVMHash } = additionalParams;
  const [fromAccount, setFromAccount] = useState<string>("");
  const [toAccount, setToAccount] = useState<string>(toAddress || "");

  // if initial renVMHash is not present, that means new transaction
  const [shouldResolveAccounts] = useState(Boolean(!renVMHash));
  const handleAccountsResolved = useCallback(
    (resolvedFromAccount: string, resolvedToAccount: string) => {
      setFromAccount(resolvedFromAccount);
      setToAccount(resolvedToAccount);
    },
    []
  );

  const accountsResolved = fromAccount && toAccount;

  // resolve accounts for new transactions
  if (shouldResolveAccounts && !accountsResolved) {
    return (
      <H2HAccountsResolver
        transactionType="mint"
        from={from}
        to={to}
        onResolved={handleAccountsResolved}
      />
    );
  }
  return (
    <MintH2HGatewayProcess
      fromAccount={fromAccount}
      toAccount={toAccount}
      location={location}
      {...rest}
    />
  );
};

type MintH2HGatewayProcessProps = RouteComponentProps & {
  fromAccount: string;
  toAccount: string;
};

export const MintH2HGatewayProcess: FunctionComponent<
  MintH2HGatewayProcessProps
> = ({ history, location, fromAccount, toAccount }) => {
  const { t } = useTranslation();
  const allChains = useCurrentNetworkChains();

  const {
    gatewayParams,
    additionalParams,
    error: parseError,
  } = parseGatewayQueryString(location.search);
  // TODO: toAddress from renVM
  const { asset, from, to, amount, toAddress: toAddressParam } = gatewayParams;
  const { renVMHash } = additionalParams;
  const [gatewayChains] = useState(pickChains(allChains, from, to));

  const { account: fromAccountWallet } = useWallet(from);
  // TODO: warnings?
  const toAddress = toAddressParam || toAccount;
  const fromAddress = fromAccount || fromAccountWallet;
  const { gateway, transactions, recoverLocalTx, error } = useGateway(
    {
      asset,
      from,
      to,
      amount,
      toAddress: toAddress,
    },
    {
      chains: gatewayChains,
    }
  );

  // TODO: DRY
  const { showNotification } = useNotifications();
  const [recoveryMode] = useState(Boolean(renVMHash));
  const [recoveringStarted, setRecoveringStarted] = useState(false);
  const [recoveringError, setRecoveringError] = useState<Error | null>(null);
  const { persistLocalTx, findLocalTx } = useTxsStorage();

  useEffect(() => {
    if (
      recoveryMode &&
      renVMHash &&
      fromAddress &&
      gateway !== null &&
      !recoveringStarted
    ) {
      setRecoveringStarted(true);
      console.log("recovering tx: " + trimAddress(renVMHash));
      const localTx = findLocalTx(fromAddress, renVMHash);
      if (localTx === null) {
        console.error(`Unable to find tx for ${fromAddress}, ${renVMHash}`);
        return;
      } else {
        recoverLocalTx(renVMHash, localTx)
          .then(() => {
            showNotification(
              `Transaction ${trimAddress(renVMHash)} recovered.`,
              {
                variant: "success",
              }
            );
          })
          .catch((error) => {
            console.error(`Recovering error`, error.message);
            showNotification(`Failed to recover transaction`, {
              variant: "error",
            });
            setRecoveringError(error);
          });
      }
    }
  }, [
    recoveryMode,
    showNotification,
    fromAddress,
    toAddress,
    renVMHash,
    recoveringStarted,
    findLocalTx,
    gateway,
    recoverLocalTx,
  ]);

  const transaction = transactions[0] || null;
  (window as any).gateway = gateway;
  (window as any).transactions = transactions;
  (window as any).transaction = transaction;

  // gateway.inSetup is accepted;
  console.log("gateway", gateway);
  return (
    <>
      <GatewayPaperHeader title="Mint" />
      {gateway === null && (
        <PCW>
          <GatewayLoaderStatus />
        </PCW>
      )}
      {gateway !== null && (
        <MintH2HProcessor
          gateway={gateway}
          transaction={transaction}
          persistLocalTx={persistLocalTx}
          fromAccount={fromAddress}
          toAccount={toAddress}
          recoveryMode={recoveryMode}
        />
      )}
      {Boolean(parseError) && (
        <GeneralErrorDialog
          open={true}
          reason={parseError}
          alternativeActionText={t("navigation.back-to-start-label")}
          onAlternativeAction={() => history.push({ pathname: paths.MINT })}
        />
      )}
      {Boolean(recoveringError) && (
        <GeneralErrorDialog
          open={true}
          error={recoveringError}
          alternativeActionText={t("navigation.back-to-start-label")}
          onAlternativeAction={() => history.push({ pathname: paths.MINT })}
        />
      )}
      {error !== null && (
        <GeneralErrorDialog
          open={true}
          reason={"Failed to load gateway"}
          error={error}
          actionText={t("navigation.back-to-home-label")}
          onAction={() => history.push({ pathname: paths.HOME })}
        />
      )}
      <Debug it={{}} />
    </>
  );
};

type MintH2HProcessorProps = {
  gateway: Gateway;
  transaction: GatewayTransaction | null;
  persistLocalTx: LocalTxPersistor;
  fromAccount: string;
  toAccount: string;
  recoveryMode?: boolean;
};

const MintH2HProcessor: FunctionComponent<MintH2HProcessorProps> = ({
  gateway,
  transaction,
  persistLocalTx,
  fromAccount,
  toAccount,
  recoveryMode,
}) => {
  const history = useHistory();
  const allChains = useCurrentNetworkChains();
  const { asset, from, to, amount } = getGatewayParams(gateway);
  const fees = useGatewayFeesWithRates(gateway, amount || 0);

  const { outputAmount, outputAmountUsd } = fees;

  const inSetupApprovalSubmitter = useChainTransactionSubmitter({
    tx: gateway.inSetup.approval,
    debugLabel: "inSetup.approval",
  });
  const {
    handleSubmit: handleSubmitApproval,
    submitting: submittingApproval,
    submittingDone: submittingApprovalDone,
  } = inSetupApprovalSubmitter;

  const inSetupApprovalTxMeta = useChainTransactionStatusUpdater({
    tx: gateway.inSetup.approval,
    debugLabel: "inSetup.approval",
    startTrigger: submittingApprovalDone || recoveryMode,
  });

  const { status: approvalStatus } = inSetupApprovalTxMeta;
  // TODO: solana

  const gatewayInSubmitter = useChainTransactionSubmitter({
    tx: gateway.in,
    debugLabel: "in",
  });
  const {
    handleSubmit: handleSubmitLock,
    submitting: submittingLock,
    submittingDone: submittingLockDone,
    waiting: waitingLock,
    done: doneLock,
    errorSubmitting: errorSubmittingLock,
    handleReset: handleResetLock,
  } = gatewayInSubmitter;

  //TODO: DRY
  useEffect(() => {
    if (fromAccount && transaction !== null) {
      console.log("persisting local tx");
      persistLocalTx(fromAccount, transaction);
      const params = new URLSearchParams(history.location.search);
      const renVMHashTx = transaction.hash;
      const renVMHashParam = (params as any).renVMHash;
      console.log("renVMHash param", renVMHashTx, params);
      if (renVMHashTx !== renVMHashParam) {
        params.set("renVMHash", renVMHashTx);
        params.set("toAddress", toAccount);
        history.replace({
          search: params.toString(),
        });
      }
    }
  }, [
    history,
    persistLocalTx,
    fromAccount,
    submittingLockDone,
    transaction,
    toAccount,
  ]);

  const gatewayInTxMeta = useChainTransactionStatusUpdater({
    tx: transaction?.in || gateway.in, // not the case
    // tx: gateway.in, // not the case
    startTrigger: submittingLockDone || recoveryMode,
    debugLabel: "in",
  });
  const {
    confirmations: lockConfirmations,
    target: lockTargetConfirmations,
    status: lockStatus,
    txUrl: lockTxUrl,
    amount: lockAmount,
  } = gatewayInTxMeta;

  const renVMSubmitter = useChainTransactionSubmitter({
    tx: transaction?.renVM,
    autoSubmit:
      lockStatus === ChainTransactionStatus.Done &&
      isTxSubmittable(transaction?.renVM),
    debugLabel: "renVM",
  });
  const renVMTxMeta = useRenVMChainTransactionStatusUpdater({
    tx: transaction?.renVM,
    startTrigger: renVMSubmitter.submittingDone || recoveryMode,
    debugLabel: "renVM",
  });
  const { status: renVMStatus, amount: mintAmount } = renVMTxMeta;

  // wallet provider start
  const activeChain = renVMStatus !== null ? to : from;
  useSyncWalletChain(activeChain);
  const { connected, provider } = useWallet(activeChain);
  useEffect(() => {
    console.log("activeChain changed", activeChain);
    if (provider && connected) {
      alterContractChainProviderSigner(allChains, activeChain, provider);
    }
  }, [allChains, activeChain, provider, connected]);

  const { chain } = useSelector($wallet);
  const { connected: toConnected } = useWallet(to);
  const showSwitchWalletDialog =
    renVMStatus !== null && !toConnected && chain !== to;

  const outSubmitter = useChainTransactionSubmitter({
    tx: transaction?.out,
    debugLabel: "out",
  });

  const {
    handleSubmit: handleSubmitMint,
    submitting: submittingMint,
    // submittingDone: submittingMintDone,
    waiting: waitingMint,
    done: doneMint,
    errorSubmitting: errorSubmittingMint,
    handleReset: handleResetMint,
  } = outSubmitter;

  const outTxMeta = useChainTransactionStatusUpdater({
    tx: transaction?.out,
    debugLabel: "out",
    startTrigger: outSubmitter.submittingDone || recoveryMode,
  });
  const {
    status: mintStatus,
    confirmations: mintConfirmations,
    target: mintTargetConfirmations,
    txUrl: mintTxUrl,
  } = outTxMeta;

  const { decimals: lockAssetDecimals } = useChainInstanceAssetDecimals(
    gateway.fromChain,
    asset
  );

  const { decimals: mintAssetDecimals } = useChainInstanceAssetDecimals(
    gateway.toChain,
    asset
  );

  const Fees = <GatewayFees asset={asset} from={from} to={to} {...fees} />;

  const { connected: fromConnected } = useWallet(from);

  const isCompleted = mintTxUrl !== null;
  useEffect(() => {
    if (transaction !== null && isCompleted) {
      console.log("persisting final tx", transaction);
      persistLocalTx(fromAccount, transaction, true);
    }
  }, [persistLocalTx, fromAccount, isCompleted, transaction]);

  useSetCurrentTxHash(transaction?.hash);

  let Content = null;
  // TODO: consider making similar to Relase H2H
  // if (!fromConnected) {
  //   Content = (
  //     <PCW>
  //       <ConnectWalletPaperSection chain={from} isRecoveringTx={recoveryMode} />
  //     </PCW>
  //   );
  // } else
  if (approvalStatus !== ChainTransactionStatus.Done && lockStatus === null) {
    Content = (
      <PaperContent bottomPadding>
        <BalanceInfoPlaceholder />
        <SendingReceivingSection
          asset={asset}
          sendingAmount={amount}
          receivingAmount={outputAmount}
          receivingAmountUsd={outputAmountUsd}
        />
        <MediumTopWrapper>
          <AddressInfo address={fromAccount} label="Sender Address" />
          <AddressInfo address={toAccount} label="Recipient Address" />
        </MediumTopWrapper>
        <MediumTopWrapper>
          <FeesToggler>{Fees}</FeesToggler>
        </MediumTopWrapper>
        <ActionButtonWrapper>
          <ActionButton
            onClick={handleSubmitApproval}
            disabled={submittingApproval || recoveryMode}
          >
            {submittingApproval
              ? "Approving Accounts & Contracts..."
              : "Approve Accounts & Contracts"}
          </ActionButton>
        </ActionButtonWrapper>
      </PaperContent>
    );
  } else if (renVMStatus === null) {
    //in case of failing, submit helpers must be here
    Content = (
      <MintH2HLockTransactionProgressStatus
        gateway={gateway}
        transaction={transaction}
        Fees={Fees}
        outputAmount={outputAmount}
        outputAmountUsd={outputAmountUsd}
        lockConfirmations={lockConfirmations}
        lockTargetConfirmations={lockTargetConfirmations}
        lockStatus={lockStatus}
        onSubmit={handleSubmitLock}
        submitting={submittingLock}
        waiting={waitingLock}
        done={doneLock}
        errorSubmitting={errorSubmittingLock}
        onReset={handleResetLock}
        submittingDisabled={recoveryMode}
      />
    );
  } else if (mintTxUrl === null) {
    Content = (
      <MintH2HMintTransactionProgressStatus
        gateway={gateway}
        transaction={transaction}
        Fees={Fees}
        outputAmount={outputAmount}
        outputAmountUsd={outputAmountUsd}
        renVMStatus={renVMStatus}
        mintAmount={mintAmount} // clean this up
        mintConfirmations={mintConfirmations}
        mintTargetConfirmations={mintTargetConfirmations}
        mintStatus={mintStatus}
        onSubmit={handleSubmitMint}
        submitting={submittingMint}
        waiting={waitingMint}
        done={doneMint}
        errorSubmitting={errorSubmittingMint}
        onReset={handleResetMint}
      />
    );
  } else {
    Content = (
      <MintH2HCompletedStatus
        gateway={gateway}
        lockTxUrl={lockTxUrl}
        lockAmount={lockAmount}
        lockAssetDecimals={lockAssetDecimals}
        mintAmount={mintAmount}
        mintAssetDecimals={mintAssetDecimals}
        mintTxUrl={mintTxUrl}
      />
    );
  }
  return (
    <>
      {Content}
      <TransactionRecoveryModal
        gateway={gateway}
        recoveryMode={fromConnected && recoveryMode}
      />
      <SwitchWalletDialog open={showSwitchWalletDialog} targetChain={to} />
      {renVMSubmitter.errorSubmitting && (
        <SubmitErrorDialog
          open={true}
          error={renVMSubmitter.errorSubmitting}
          onAction={renVMSubmitter.handleReset}
        />
      )}
      <Debug
        it={{
          recoveryMode,
          count: gateway.transactions.count(),
          inSetupApprovalSubmitter,
          inSetupApprovalTxMeta,
          gatewayInSubmitter,
          gatewayInTxMeta,
          renVMSubmitter,
          renVMTxMeta,
          outSubmitter,
          outTxMeta,
        }}
      />
    </>
  );
};
