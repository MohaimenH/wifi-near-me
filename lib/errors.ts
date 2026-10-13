export class RateLimitedError extends Error {
  constructor() { super("rate_limited"); this.name = "RateLimitedError"; }
}
export class NotFoundError extends Error {
  constructor() { super("not_found"); this.name = "NotFoundError"; }
}
export class BadJsonError extends Error {
  constructor() { super("invalid_json"); this.name = "BadJsonError"; }
}
export class UnsupportedMediaTypeError extends Error {
  constructor() { super("unsupported_media_type"); this.name = "UnsupportedMediaTypeError"; }
}
export class CrossSiteError extends Error {
  constructor() { super("cross_site"); this.name = "CrossSiteError"; }
}
