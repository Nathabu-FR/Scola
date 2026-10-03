import { create } from 'zustand'

import { Log, LogsStorage, NetworkStorage, NetworkResponse } from './types'

const REQUEST_HISTORY_LIMIT = 30;
const HOST_HISTORY_LIMIT = 24;
const LOG_HISTORY_LIMIT = 500;

export const useLogStore = create<LogsStorage>((set) => ({
  logs: [],
  addItem: (log: Log) => set(state => ({
    logs: state.logs.length >= LOG_HISTORY_LIMIT
      ? [...state.logs.slice(-(LOG_HISTORY_LIMIT - 1)), log]
      : [...state.logs, log],
  }))
}))

const sanitizeUrl = (rawUrl: string): string => {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.host}`;
};

export const useNetworkStore = create<NetworkStorage>((set, get) => ({
  hosts: new Map(),
  addRequest: (request: Request, uuid: string) => {
    const url = sanitizeUrl(request.url)
    const hosts = get().hosts;

    if (!hosts.has(url) && hosts.size >= HOST_HISTORY_LIMIT) {
      const oldestHost = hosts.keys().next().value;
      if (oldestHost) hosts.delete(oldestHost);
    }

    if (!hosts.has(url)) {
      hosts.set(url, { requests: [], responses: [] });
    }

    const requests = hosts.get(url)!.requests;
    requests.push({ [uuid]: request.clone() });
    if (requests.length > REQUEST_HISTORY_LIMIT) {
      requests.splice(0, requests.length - REQUEST_HISTORY_LIMIT);
    }

    set({ hosts: new Map(hosts) });
  },
  addResponse: (response: Response, uuid: string) => {
    const url = sanitizeUrl(response.url)
    const hosts = get().hosts;
    if (!hosts.has(url)) {
      hosts.set(url, { requests: [], responses: [] });
    }
    const metadata: NetworkResponse = { status: response.status, url: response.url };
    const responses = hosts.get(url)!.responses;
    responses.push({ [uuid]: metadata });
    if (responses.length > REQUEST_HISTORY_LIMIT) {
      responses.splice(0, responses.length - REQUEST_HISTORY_LIMIT);
    }
    set({ hosts: new Map(hosts) });
  }
}))
