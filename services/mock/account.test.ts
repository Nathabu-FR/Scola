import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { Account, Services } from "@/stores/account/types";

let mockState: {
  accounts: Account[];
  lastUsedAccount: string;
  addAccount: (account: Account) => void;
  setLastUsedAccount: (accountId: string) => void;
};

jest.mock("expo-router", () => ({
  router: {
    dismissAll: jest.fn(),
    replace: jest.fn(),
  },
}));
jest.mock("@/services/shared", () => ({
  initializeAccountManager: jest.fn(async () => undefined),
}));
jest.mock("@/stores/account", () => ({
  useAccountStore: { getState: () => mockState },
}));
jest.mock("@/utils/uuid/uuid", () => {
  let id = 0;
  return { __esModule: true, default: () => `mock-uuid-${++id}` };
});

import { createMockProfile } from "./account";

const createState = () => {
  mockState = {
    accounts: [],
    lastUsedAccount: "",
    addAccount: account => {
      mockState.accounts.push(account);
    },
    setLastUsedAccount: accountId => {
      mockState.lastUsedAccount = accountId;
    },
  };
};

describe("Mock Data account setup", () => {
  beforeEach(createState);

  it("creates and reuses the default mock profile", async () => {
    const first = await createMockProfile();
    const second = await createMockProfile();

    expect(first.id).toBe(second.id);
    expect(mockState.accounts).toHaveLength(1);
    expect(mockState.lastUsedAccount).toBe(first.id);
    expect(first.services[0].serviceId).toBe(Services.MOCK_DATA);
  });

  it("keeps Mock Data in its own account when a real account is selected", async () => {
    const now = new Date().toISOString();
    mockState.accounts = [
      {
        id: "offline-profile",
        firstName: "Alex",
        lastName: "Durand",
        custom: true,
        services: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
    mockState.lastUsedAccount = "offline-profile";

    const mockAccount = await createMockProfile();

    expect(mockState.accounts).toHaveLength(2);
    expect(mockState.accounts[0].services).toHaveLength(0);
    expect(mockState.accounts[0].firstName).toBe("Alex");
    expect(mockAccount.id).not.toBe("offline-profile");
    expect(mockAccount.services[0].serviceId).toBe(Services.MOCK_DATA);
    expect(mockState.lastUsedAccount).toBe(mockAccount.id);
  });
});
