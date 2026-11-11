export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  DEV_LOGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type User = {
  id: string;
  email: string;
  display_name: string | null;
};

export type Env = {
  Bindings: Bindings;
  Variables: {
    user: User | null;
  };
};

export type Vocab = {
  id: string;
  term: string;
  meaning: string;
  created_at: string;
};
