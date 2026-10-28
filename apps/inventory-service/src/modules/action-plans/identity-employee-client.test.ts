import { afterEach, describe, expect, it, vi } from "vitest";

import { EmployeeDirectoryUnavailableError, IdentityEmployeeClient } from "./identity-employee-client.ts";

const employeeId = "00000000-0000-4000-8000-000000000001";
const siteId = "00000000-0000-4000-8000-00000000000a";
const baseUrl = "http://identity.test";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const activeEmployee = {
  id: employeeId,
  displayName: "Dược sĩ A",
  roles: ["Pharmacist"],
  siteIds: [siteId],
  isActive: true,
};

describe("IdentityEmployeeClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the employee with the service secret, acting as the system", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-secret");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, activeEmployee));
    const client = new IdentityEmployeeClient(baseUrl, fetchMock);

    const employee = await client.findActiveEmployee(employeeId);

    expect(employee).toMatchObject({
      id: employeeId,
      displayName: "Dược sĩ A",
      roles: ["Pharmacist"],
      siteIds: [siteId],
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${baseUrl}/internal/employees/${employeeId}`);
    const headers = new Headers(init?.headers);
    expect(headers.get("x-internal-service-secret")).toBe("test-secret");
    expect(headers.get("x-actor-type")).toBe("system");
  });

  it("answers undefined for an id that is not an active employee, whether identity says 404 or inactive", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-secret");
    const notFound = new IdentityEmployeeClient(
      baseUrl,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(404, {})),
    );
    expect(await notFound.findActiveEmployee(employeeId)).toBeUndefined();

    const inactive = new IdentityEmployeeClient(
      baseUrl,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { ...activeEmployee, isActive: false })),
    );
    expect(await inactive.findActiveEmployee(employeeId)).toBeUndefined();
  });

  it("fails closed when identity errors, cannot be reached, or answers something malformed", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-secret");
    const serverError = new IdentityEmployeeClient(
      baseUrl,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(500, {})),
    );
    await expect(serverError.findActiveEmployee(employeeId)).rejects.toBeInstanceOf(EmployeeDirectoryUnavailableError);

    const unreachable = new IdentityEmployeeClient(
      baseUrl,
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(unreachable.findActiveEmployee(employeeId)).rejects.toBeInstanceOf(EmployeeDirectoryUnavailableError);

    const malformed = new IdentityEmployeeClient(
      baseUrl,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { id: "not-a-uuid" })),
    );
    await expect(malformed.findActiveEmployee(employeeId)).rejects.toBeInstanceOf(EmployeeDirectoryUnavailableError);
  });

  it("refuses to call identity without the service secret", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "");
    const fetchMock = vi.fn<typeof fetch>();
    const client = new IdentityEmployeeClient(baseUrl, fetchMock);
    await expect(client.findActiveEmployee(employeeId)).rejects.toThrow("INTERNAL_SERVICE_SECRET");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
