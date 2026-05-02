using System.Net;
using System.Text;
using PharmacyCentral.JiraSheetSync;
using Xunit;

namespace PharmacyCentral.JiraSheetSync.Tests;

public sealed class JiraClientTests
{
    [Fact]
    public async Task GetIssuesAsync_throws_when_basic_auth_is_invalid()
    {
        RecordingHandler handler = new(
            request => new HttpResponseMessage(HttpStatusCode.Unauthorized)
            {
                Content = new StringContent("Client must be authenticated to access this resource.", Encoding.UTF8, "text/plain"),
            });

        JiraClient client = new(new HttpClient(handler)
        {
            BaseAddress = new Uri("https://nielpattin.atlassian.net/"),
        });

        InvalidOperationException exception = await Assert.ThrowsAsync<InvalidOperationException>(() => client.GetIssuesAsync("PCR", CancellationToken.None));

        Assert.Contains("Jira authentication failed", exception.Message, StringComparison.Ordinal);
        Assert.Equal("/rest/api/3/myself", handler.Request!.RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task GetIssuesAsync_uses_the_enhanced_search_endpoint()
    {
        RecordingHandler handler = new(
            request => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = request.RequestUri!.AbsolutePath == "/rest/api/3/myself"
                    ? new StringContent("{\"displayName\":\"Niel\"}", Encoding.UTF8, "application/json")
                    : new StringContent("{\"issues\":[],\"isLast\":true}", Encoding.UTF8, "application/json"),
            });

        JiraClient client = new(new HttpClient(handler)
        {
            BaseAddress = new Uri("https://nielpattin.atlassian.net/"),
        });

        await client.GetIssuesAsync("PCR", CancellationToken.None);

        Assert.NotNull(handler.Request);
        Assert.Equal(HttpMethod.Get, handler.Request!.Method);
        Assert.Equal("/rest/api/3/search/jql", handler.Request.RequestUri!.AbsolutePath);
        Assert.Contains("jql=project%20%3D%20PCR%20ORDER%20BY%20rank%20ASC", handler.Request.RequestUri.Query, StringComparison.Ordinal);
    }

    [Fact]
    public async Task GetIssuesAsync_accepts_timestamp_dates_from_sprint_fields()
    {
        RecordingHandler handler = new(
            request => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = request.RequestUri!.AbsolutePath == "/rest/api/3/myself"
                    ? new StringContent("{\"displayName\":\"Niel\"}", Encoding.UTF8, "application/json")
                    : new StringContent("""
                        {
                          "issues": [
                            {
                              "key": "PCR-1",
                              "fields": {
                                "summary": "Planning",
                                "issuetype": { "name": "Epic" },
                                "status": { "name": "To Do", "statusCategory": { "name": "To Do" } },
                                "priority": { "name": "Medium" },
                                "updated": "2026-04-12T17:00:00.000Z",
                                "customfield_10020": [
                                  {
                                    "name": "Sprint 1",
                                    "startDate": "2026-04-12T17:00:00.000Z",
                                    "endDate": "2026-04-26T17:00:00.000Z"
                                  }
                                ]
                              }
                            }
                          ],
                          "isLast": true
                        }
                        """, Encoding.UTF8, "application/json"),
            });

        JiraClient client = new(new HttpClient(handler)
        {
            BaseAddress = new Uri("https://nielpattin.atlassian.net/"),
        });

        IReadOnlyList<JiraIssue> issues = await client.GetIssuesAsync("PCR", CancellationToken.None);

        Assert.Single(issues);
        Assert.Equal(new DateOnly(2026, 4, 12), issues[0].SprintStart);
        Assert.Equal(new DateOnly(2026, 4, 26), issues[0].SprintEnd);
    }

    private sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            return Task.FromResult(responder(request));
        }
    }
}
