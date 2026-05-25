export interface JiraSearchResponse {
  issues: JiraIssueDto[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
  nextPageToken?: string | null;
}

export interface JiraIssueDto {
  key: string;
  fields: JiraIssueFieldsDto;
}

export interface JiraIssueFieldsDto {
  summary: string;
  issuetype?: JiraNamedValueDto | null;
  parent?: JiraParentDto | null;
  assignee?: JiraUserDto | null;
  created?: string | null;
  updated?: string | null;
  duedate?: string | null;
  priority?: JiraNamedValueDto | null;
  status?: JiraStatusDto | null;
  labels?: string[] | null;
  customfield_10015?: string | null;
  customfield_10020?: JiraSprintDto[] | null;
}

export interface JiraParentDto {
  key: string;
}

export interface JiraNamedValueDto {
  name: string;
}

export interface JiraUserDto {
  displayName: string;
}

export interface JiraStatusDto {
  name: string;
  statusCategory?: JiraStatusCategoryDto | null;
}

export interface JiraStatusCategoryDto {
  name: string;
}

export interface JiraSprintDto {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  state?: string | null;
}
