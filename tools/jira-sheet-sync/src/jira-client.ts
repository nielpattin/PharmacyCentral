import type { JiraIssue } from './models.ts';
import type { JiraSearchResponse, JiraIssueDto, JiraSprintDto } from './jira-api-models.ts';

interface HttpClient {
  baseUrl: string;
  headers: Record<string, string>;
  fetchFn: typeof globalThis.fetch;
}

export class JiraClient {
  private readonly httpClient: HttpClient;

  constructor(baseUrl: string, email: string, apiToken: string);
  constructor(baseUrl: string, email: string, apiToken: string, fetchFn?: typeof globalThis.fetch);
  constructor(baseUrl: string, email: string, apiToken: string, fetchFn?: typeof globalThis.fetch) {
    const normalizedBase = baseUrl.replace(/\/+$/, '') + '/';
    const credentials = Buffer.from(`${email}:${apiToken}`).toString('base64');
    this.httpClient = {
      baseUrl: normalizedBase,
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
      fetchFn: fetchFn ?? globalThis.fetch.bind(globalThis),
    };
  }

  async getIssuesAsync(projectKey: string): Promise<JiraIssue[]> {
    await this.ensureAuthenticatedAsync();

    const issues: JiraIssue[] = [];
    let nextPageToken: string | null = null;
    const pageSize = 100;

    const fields = [
      'summary',
      'status',
      'issuetype',
      'assignee',
      'created',
      'updated',
      'duedate',
      'parent',
      'labels',
      'priority',
      'customfield_10015',
      'customfield_10020',
    ] as const;

    while (true) {
      const uri = this.buildSearchUri(projectKey, fields, pageSize, nextPageToken);
      const response = await this.httpClient.fetchFn(`${this.httpClient.baseUrl}${uri}`, {
        headers: this.httpClient.headers,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Jira search failed (${response.status} ${response.statusText}): ${errorBody}`);
      }

      const page = (await response.json()) as JiraSearchResponse;
      if (!page.issues || page.issues.length === 0) {
        break;
      }

      for (const dto of page.issues) {
        issues.push(this.mapIssue(dto, issues.length));
      }

      if (page.isLast || !page.nextPageToken) {
        break;
      }

      nextPageToken = page.nextPageToken;
    }

    return issues;
  }

  private async ensureAuthenticatedAsync(): Promise<void> {
    const response = await this.httpClient.fetchFn(`${this.httpClient.baseUrl}rest/api/3/myself`, {
      headers: this.httpClient.headers,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Jira authentication failed (${response.status} ${response.statusText}). Check JIRA_EMAIL and JIRA_API_TOKEN. ${errorBody}`,
      );
    }
  }

  private buildSearchUri(
    projectKey: string,
    fields: readonly string[],
    pageSize: number,
    nextPageToken: string | null,
  ): string {
    const params = new URLSearchParams();
    params.set('jql', `project = ${projectKey} ORDER BY rank ASC`);
    params.set('maxResults', String(pageSize));

    for (const field of fields) {
      params.append('fields', field);
    }

    if (nextPageToken) {
      params.set('nextPageToken', nextPageToken);
    }

    return `rest/api/3/search/jql?${params.toString()}`;
  }

  private mapIssue(dto: JiraIssueDto, order: number): JiraIssue {
    const sprint: JiraSprintDto | undefined =
      dto.fields.customfield_10020 && dto.fields.customfield_10020.length > 0
        ? dto.fields.customfield_10020[dto.fields.customfield_10020.length - 1]
        : undefined;

    return {
      key: dto.key,
      summary: dto.fields.summary,
      issueType: dto.fields.issuetype?.name ?? 'Task',
      parentKey: dto.fields.parent?.key ?? null,
      assignee: dto.fields.assignee?.displayName ?? null,
      startDate: dto.fields.customfield_10015 ?? null,
      dueDate: dto.fields.duedate ?? null,
      status: dto.fields.status?.name ?? '',
      statusCategory: dto.fields.status?.statusCategory?.name ?? '',
      sprintName: sprint?.name ?? null,
      sprintStart: sprint?.startDate ?? null,
      sprintEnd: sprint?.endDate ?? null,
      priority: dto.fields.priority?.name ?? '',
      labels: dto.fields.labels ?? [],
      lastUpdated: dto.fields.updated ?? '',
      originalOrder: order,
    };
  }
}
