import type { ImportDataset } from "../import-datasets.ts";
import { ImportPage } from "./import/import-page.tsx";

export const ImportSection = ({ dataset }: { dataset: ImportDataset }): React.JSX.Element => (
  <ImportPage dataset={dataset} />
);
