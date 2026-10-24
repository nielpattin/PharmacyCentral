import { masterDataConfigs, type MasterDataKind } from "./master-data/master-data-config.ts";
import { MasterDataList } from "./master-data/master-data-list.tsx";

// Each route owns one record type: sites, storage locations or suppliers.
export type MasterDataPage = MasterDataKind;

export const MasterDataSection = ({ kind }: { kind: MasterDataPage }): React.JSX.Element => (
  <MasterDataList config={masterDataConfigs[kind]} />
);
