import { describe, it, expect } from 'vitest';
import { JiraClient } from '../src/jira-client.js';

function mockFetch(handler: (request: Request) => Response): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return Promise.resolve(handler(request));
  }) as typeof globalThis.fetch;
}

describe('JiraClient', () => {
  it('throws when basic auth is invalid', async () => {
    const fetchFn = mockFetch((request) => {
      if (request.url.endsWith('/rest/api/3/myself')) {
        return new Response('Client must be authenticated to access this resource.', {
          status: 401,
          statusText: 'Unauthorized',
        });
      }
      return new Response(null, { status: 404 });
    });

    const client = new JiraClient('https://nielpattin.atlassian.net/', 'test@test.com', 'token', fetchFn);

    await expect(client.getIssuesAsync('PCR')).rejects.toThrow('Jira authentication failed');
  });

  it('uses the enhanced search endpoint', async () => {
    let requestUrl: Request | null = null;
    const fetchFn = mockFetch((request) => {
      requestUrl = request;
      if (request.url.endsWith('/rest/api/3/myself')) {
        return new Response('{"displayName":"Niel"}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{"issues":[],"isLast":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new JiraClient('https://nielpattin.atlassian.net/', 'test@test.com', 'token', fetchFn);
    await client.getIssuesAsync('PCR');

    expect(requestUrl!.url).toContain('/rest/api/3/search/jql');
    expect(requestUrl!.url).toContain('jql=project+%3D+PCR+ORDER+BY+rank+ASC');
  });

  it('accepts timestamp dates from sprint fields', async () => {
    const fetchFn = mockFetch((request) => {
      if (request.url.endsWith('/rest/api/3/myself')) {
        return new Response('{"displayName":"Niel"}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          issues: [
            {
              key: 'PCR-1',
              fields: {
                summary: 'Planning',
                issuetype: { name: 'Epic' },
                status: { name: 'To Do', statusCategory: { name: 'To Do' } },
                priority: { name: 'Medium' },
                updated: '2026-04-12T17:00:00.000Z',
                customfield_10020: [
                  {
                    name: 'Sprint 1',
                    startDate: '2026-04-12T17:00:00.000Z',
                    endDate: '2026-04-26T17:00:00.000Z',
                  },
                ],
              },
            },
          ],
          isLast: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const client = new JiraClient('https://nielpattin.atlassian.net/', 'test@test.com', 'token', fetchFn);
    const issues = await client.getIssuesAsync('PCR');

    expect(issues).toHaveLength(1);
    expect(issues[0].sprintStart).toBe('2026-04-12T17:00:00.000Z');
    expect(issues[0].sprintEnd).toBe('2026-04-26T17:00:00.000Z');
  });
});
