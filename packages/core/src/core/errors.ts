export class ScrapeError extends Error {
  constructor(
    message: string,
    readonly platform: string,
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
