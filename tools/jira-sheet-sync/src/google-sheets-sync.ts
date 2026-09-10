import type { TimelinePlan, TimelineRow } from './models.ts';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const HELPER_COLUMN_COUNT = 20;
const HELPER_ROW_COUNT = 1000;
const HELPER_WRITE_BATCH_SIZE = 8;
const VISIBLE_WRITE_BATCH_SIZE = 4;
const VISIBLE_HEADER_ROW = 3;
const VISIBLE_FIRST_DATA_ROW = 4;
const VISIBLE_LAST_DATA_ROW = 150;

const HELPER_HEADERS = [
  'Jira Key',
  'Issue Type',
  'Summary',
  'WBS Number',
  'Epic Key',
  'Epic Summary',
  'Parent Key',
  'Sprint Name',
  'Sprint Start',
  'Sprint End',
  'Status',
  'Status Category',
  'Assignee',
  'Start Date',
  'Due Date',
  'Duration Days',
  'Percent Complete',
  'Priority',
  'Labels',
  'Last Updated',
] as const;

export interface WriteBatch {
  range: string;
  values: (string | number | null)[][];
}

export class GoogleSheetsSync {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async syncAsync(
    spreadsheetId: string,
    plan: TimelinePlan,
    helperSheetName: string,
    visibleSheetName: string,
  ): Promise<void> {
    await this.ensureSheetAsync(spreadsheetId, helperSheetName, HELPER_ROW_COUNT, HELPER_COLUMN_COUNT);
    const visibleSheetId = await this.ensureSheetAsync(spreadsheetId, visibleSheetName, VISIBLE_LAST_DATA_ROW, 14);

    await this.clearAsync(spreadsheetId, `${helperSheetName}!A2:T${HELPER_ROW_COUNT}`);

    await this.writeAsync(spreadsheetId, `${helperSheetName}!A1:T1`, [[...HELPER_HEADERS]], false);

    const batches = buildHelperWriteBatches(plan.helperRows, helperSheetName, HELPER_WRITE_BATCH_SIZE);
    for (const batch of batches) {
      await this.writeAsync(spreadsheetId, batch.range, batch.values, false);
    }

    await this.clearAsync(spreadsheetId, `${visibleSheetName}!B1:N${VISIBLE_LAST_DATA_ROW}`);
    await this.writeAsync(spreadsheetId, `${visibleSheetName}!B1:N2`, buildVisibleSummaryValues(helperSheetName), true);
    await this.writeAsync(
      spreadsheetId,
      `${visibleSheetName}!B${VISIBLE_HEADER_ROW}:N${VISIBLE_HEADER_ROW}`,
      buildVisibleHeaders(),
      false,
    );

    await this.applyVisibleSheetStylesAsync(spreadsheetId, visibleSheetId);

    const visibleValues = buildVisibleFormulaValues(helperSheetName);
    let visibleOffset = 0;
    while (visibleOffset < visibleValues.length) {
      const chunkSize = Math.min(VISIBLE_WRITE_BATCH_SIZE, visibleValues.length - visibleOffset);
      const startRow = VISIBLE_FIRST_DATA_ROW + visibleOffset;
      const endRow = startRow + chunkSize - 1;
      const chunk = visibleValues.slice(visibleOffset, visibleOffset + chunkSize);
      await this.writeAsync(spreadsheetId, `${visibleSheetName}!B${startRow}:N${endRow}`, chunk, true);
      visibleOffset += chunkSize;
    }
  }

  private async ensureSheetAsync(spreadsheetId: string, sheetName: string, targetRowCount: number, targetColumnCount: number): Promise<number> {
    const metadata = await this.getSpreadsheetMetadataAsync(spreadsheetId);
    const existingSheet = metadata.sheets?.find(
      (s: SheetMetadata) => s.properties.title.toLowerCase() === sheetName.toLowerCase(),
    );

    if (!existingSheet) {
      const createResult = await this.batchUpdateAsync<BatchUpdateResponse>(spreadsheetId, {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
                gridProperties: {
                  rowCount: targetRowCount,
                  columnCount: targetColumnCount,
                },
              },
            },
          },
        ],
      });

      return createResult.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
    }

    if (
      existingSheet.properties.gridProperties.rowCount < targetRowCount ||
      existingSheet.properties.gridProperties.columnCount < targetColumnCount
    ) {
      await this.batchUpdateAsync(spreadsheetId, {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: existingSheet.properties.sheetId,
                gridProperties: {
                  rowCount: Math.max(existingSheet.properties.gridProperties.rowCount, targetRowCount),
                  columnCount: Math.max(existingSheet.properties.gridProperties.columnCount, targetColumnCount),
                },
              },
              fields: 'gridProperties.rowCount,gridProperties.columnCount',
            },
          },
        ],
      });
    }

    return existingSheet.properties.sheetId;
  }

  private async applyVisibleSheetStylesAsync(spreadsheetId: string, sheetId: number): Promise<void> {
    // Clear all existing conditional format rules to prevent duplicates
    const metadata = await this.getSpreadsheetMetadataAsync(spreadsheetId);
    const existingRuleCount = metadata.sheets?.find(
      (s: SheetMetadata) => s.properties.sheetId === sheetId,
    )?.conditionalFormats?.length ?? 0;

    const deleteRequests = [];
    for (let index = existingRuleCount - 1; index >= 0; index--) {
      deleteRequests.push({ deleteConditionalFormatRule: { sheetId, index } });
    }

    const requests = [
      ...deleteRequests,
      // Merge title row B1:N1
      {
        mergeCells: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 1,
            endColumnIndex: 14,
          },
          mergeType: 'MERGE_ALL',
        },
      },
      // Freeze first 3 rows
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              frozenRowCount: 3,
            },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      // Hide gridlines
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              hideGridlines: true,
            },
          },
          fields: 'gridProperties.hideGridlines',
        },
      },
      // Tab color - orange
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            tabColor: {
              red: 0.23921569,
              green: 0.52156866,
              blue: 0.7764706,
            },
          },
          fields: 'tabColor',
        },
      },
      // Basic filter on B3:N149
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId,
              startRowIndex: 2,
              endRowIndex: 150,
              startColumnIndex: 1,
              endColumnIndex: 14,
            },
          },
        },
      },
      // Conditional format: Story rows
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [
              { sheetId, startRowIndex: 2, endRowIndex: 150, startColumnIndex: 1, endColumnIndex: 6 },
              { sheetId, startRowIndex: 2, endRowIndex: 150, startColumnIndex: 7, endColumnIndex: 14 },
            ],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=$D3="Story"' }],
              },
              format: {
                backgroundColor: { red: 0.9490196, green: 0.9764706, blue: 0.9098039 },
              },
            },
          },
        },
      },
      // Conditional format: Epic rows
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [
              { sheetId, startRowIndex: 2, endRowIndex: 150, startColumnIndex: 1, endColumnIndex: 6 },
              { sheetId, startRowIndex: 2, endRowIndex: 150, startColumnIndex: 7, endColumnIndex: 14 },
            ],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=$D3="Epic"' }],
              },
              format: {
                backgroundColor: { red: 0.85882354, green: 0.92941177, blue: 1 },
                textFormat: { bold: true, foregroundColor: { red: 0.039215688, green: 0.1882353, blue: 0.3764706 } },
              },
            },
          },
        },
      },
      // Conditional format: Status = "To Do"
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 3, endRowIndex: 150, startColumnIndex: 6, endColumnIndex: 7 }],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'To Do' }] },
              format: {
                backgroundColor: { red: 0.91764706, green: 0.92941177, blue: 0.9490196 },
                textFormat: { bold: true, foregroundColor: { red: 0.2784314, green: 0.30980393, blue: 0.35686275 } },
              },
            },
          },
        },
      },
      // Conditional format: Status = "In Progress"
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 3, endRowIndex: 150, startColumnIndex: 6, endColumnIndex: 7 }],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'In Progress' }] },
              format: {
                backgroundColor: { red: 0.7490196, green: 0.8784314, blue: 1 },
                textFormat: { bold: true, foregroundColor: { red: 0.039215688, green: 0.24705882, blue: 0.54901963 } },
              },
            },
          },
        },
      },
      // Conditional format: Status = "Done"
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId, startRowIndex: 3, endRowIndex: 150, startColumnIndex: 6, endColumnIndex: 7 }],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Done' }] },
              format: {
                backgroundColor: { red: 0.76862746, green: 0.9372549, blue: 0.81960785 },
                textFormat: { bold: true, foregroundColor: { red: 0.08627451, green: 0.3372549, blue: 0.1764706 } },
              },
            },
          },
        },
      },
    ];

    await this.batchUpdateAsync(spreadsheetId, { requests });
  }

  private async clearAsync(spreadsheetId: string, range: string): Promise<void> {
    const encodedRange = encodeURIComponent(range);
    const response = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodedRange}:clear`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Sheets clear failed (${response.status}): ${body}`);
    }
  }

  private async writeAsync(
    spreadsheetId: string,
    range: string,
    values: (string | number | null)[][],
    userEntered: boolean,
  ): Promise<void> {
    const encodedRange = encodeURIComponent(range);
    const valueInputOption = userEntered ? 'USER_ENTERED' : 'RAW';
    const response = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodedRange}?valueInputOption=${valueInputOption}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          majorDimension: 'ROWS',
          values,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Sheets write failed (${response.status}): ${body}`);
    }
  }

  private async batchUpdateAsync<T>(spreadsheetId: string, body: unknown): Promise<T> {
    const response = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google Sheets batchUpdate failed (${response.status}): ${errorBody}`);
    }

    return (await response.json()) as T;
  }

  private async getSpreadsheetMetadataAsync(spreadsheetId: string): Promise<SpreadsheetMetadata> {
    const response = await fetch(
      `${SHEETS_BASE}/${spreadsheetId}`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google Sheets get failed (${response.status}): ${body}`);
    }

    const metadata = (await response.json()) as SpreadsheetMetadata;
    return metadata;
  }
}

export function buildHelperWriteBatches(
  rows: TimelineRow[],
  helperSheetName: string,
  batchSize: number,
): WriteBatch[] {
  const batches: WriteBatch[] = [];

  let offset = 0;
  while (offset < rows.length) {
    const chunkSize = Math.min(batchSize, rows.length - offset);
    const startRow = 2 + offset;
    const endRow = startRow + chunkSize - 1;
    const chunk = rows.slice(offset, offset + chunkSize).map(buildHelperDataRow);
    batches.push({ range: `${helperSheetName}!A${startRow}:T${endRow}`, values: chunk });
    offset += chunkSize;
  }

  return batches;
}

function buildHelperDataRow(row: TimelineRow): (string | number | null)[] {
  return [
    row.key,
    row.issueType,
    row.summary,
    row.wbsNumber,
    row.epicKey,
    row.epicSummary,
    row.parentKey,
    row.sprintName,
    row.sprintStart,
    row.sprintEnd,
    row.status,
    row.statusCategory,
    row.assignee,
    row.startDate,
    row.dueDate,
    row.durationDays,
    row.percentComplete,
    row.priority,
    row.labels,
    row.lastUpdated,
  ];
}

function buildVisibleSummaryValues(helperSheetName: string): (string | null)[][] {
  return [
    ['PHARMACY Central Project Timeline', '', '', '', '', '', '', '', '', '', '', '', ''],
    [
      `="Total: "&COUNTA('${helperSheetName}'!A2:A)`,
      `="Done: "&COUNTIF('${helperSheetName}'!K2:K;"Done")`,
      `="In Progress: "&COUNTIF('${helperSheetName}'!K2:K;"In Progress")`,
      `="To Do: "&COUNTIF('${helperSheetName}'!K2:K;"To Do")`,
      `="Completion: "&TEXT(IFERROR(COUNTIF('${helperSheetName}'!K2:K;"Done")/COUNTA('${helperSheetName}'!A2:A);0);"0%")`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ],
  ];
}

function buildVisibleHeaders(): (string | null)[][] {
  return [
    ['WBS', 'Jira Key', 'Type', 'Task', 'Assigned', 'Status', 'Priority', 'Sprint', 'Start', 'Due', 'Days', 'Done', 'Progress'],
  ];
}

function buildVisibleFormulaValues(helperSheetName: string): (string | null)[][] {
  const values: (string | null)[][] = [];

  for (let rowOffset = 0; rowOffset < VISIBLE_LAST_DATA_ROW - VISIBLE_FIRST_DATA_ROW + 1; rowOffset++) {
    values.push([
      `=IFERROR(INDEX('${helperSheetName}'!D:D;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!A:A;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!B:B;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!C:C;ROW()-2);"")`,
      `=IFERROR(SWITCH(INDEX('${helperSheetName}'!M:M;ROW()-2);"Niel";"Trần Thành Long";"Quý Vương quang";"Vương Quang Quý";INDEX('${helperSheetName}'!M:M;ROW()-2));"")`,
      `=IFERROR(INDEX('${helperSheetName}'!K:K;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!R:R;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!H:H;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!N:N;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!O:O;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!P:P;ROW()-2);"")`,
      `=IFERROR(INDEX('${helperSheetName}'!Q:Q;ROW()-2);"")`,
      `=IFERROR(IF(INDEX('${helperSheetName}'!A:A;ROW()-2)="";"";REPT("█";ROUND(VALUE(SUBSTITUTE(INDEX('${helperSheetName}'!Q:Q;ROW()-2);"%";""))/10))&REPT("░";10-ROUND(VALUE(SUBSTITUTE(INDEX('${helperSheetName}'!Q:Q;ROW()-2);"%";""))/10)));"")`,
    ]);
  }

  return values;
}

interface BatchUpdateResponse {
  replies?: Array<{
    addSheet?: {
      properties?: {
        sheetId?: number;
      };
    };
  }>;
}

interface SpreadsheetMetadata {
  sheets?: SheetMetadata[];
}

interface SheetMetadata {
  properties: SheetProperties;
  conditionalFormats?: Array<{
    ranges?: Array<{
      startRowIndex?: number;
      endRowIndex?: number;
      startColumnIndex?: number;
      endColumnIndex?: number;
    }>;
    booleanRule?: {
      condition?: {
        type?: string;
        values?: Array<{ userEnteredValue?: string }>;
      };
      format?: {
        backgroundColor?: { red?: number; green?: number; blue?: number };
        textFormat?: { bold?: boolean; foregroundColor?: { red?: number; green?: number; blue?: number } };
      };
    };
  }>;
}

interface SheetProperties {
  sheetId: number;
  title: string;
  gridProperties: GridProperties;
}

interface GridProperties {
  rowCount: number;
  columnCount: number;
}
