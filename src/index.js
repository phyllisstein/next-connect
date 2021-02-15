import Trouter from "trouter";

/**
 * @template Request,Response
 * @typedef NextConnect
 * @type {(req: Request, res: Response) => Promise<any>}
 * @property {any[]} [routes]
 */

/**
 * @public
 * @typedef NextFunction
 * @type {(err?: any) => void}
 */

/**
 * @public
 * @template Request,Response
 * @typedef RequestHandler
 * @type {(req: Request, res: Response, next: NextFunction) => any | Promise<any>}
 */

/**
 * @public
 * @template Request,Response
 * @typedef Middleware
 * @type {NextConnect<Request,Response> | RequestHandler<Request,Response>}
 */

/**
 * @public
 * @template Request,Response
 * @typedef ErrorHandler
 * @type {(err: any, req: Request, res: Response, next: NextFunction) => any | Promise<any>}
 */

/**
 * @public
 * @template Request,Response
 * @typedef {Object} Options
 * @property {boolean} [attachParams] Whether to attach `params` object to `req`
 * @property {ErrorHandler<Request,Response>} [onError] Handler to catch all errors 
 * @property {RequestHandler<Request,Response>} [onNoMatch] Handler when no route is matched
 */

/** 
 * @public
 * @type {ErrorHandler<import("http").IncomingMessage,import("http").ServerResponse>}
 */
const onerror = (err, req, res) =>
  (res.statusCode = err.status || 500) && res.end(err.message);

/**
 * @param {import("http").ServerResponse} res 
 */
const isResSent = (res) => res.finished || res.headersSent || res.writableEnded;

/**
 * @param {Middleware<unknown,unknown>} fn 
 */
const mount = (fn) => ('handle' in fn ? fn.handle.bind(fn) : fn);

const noop = () => undefined;

/**
 * @template Request,Response
 * @param {Options<Request,Response>} options 
 */
export default function factory({
  onError = onerror,
  onNoMatch = onerror.bind(null, { status: 404, message: "not found" }),
  attachParams = false,
} = {}) {
  /** @type {NextConnect<Request,Response>} */
  function nc(req, res) {
    return nc.run(req, res).then(
      () => !isResSent(res) && onNoMatch(req, res, noop),
      (err) => onError(err, req, res, noop)
    );
  }
  nc.routes = [];
  const _use = Trouter.prototype.use.bind(nc);
  const _find = Trouter.prototype.find.bind(nc);
  const _add = Trouter.prototype.add.bind(nc);
  /** @private @type {(method: (import("trouter").HTTPMethod | ""), base: string | Middleware<Request,Response>, ...fns: Middleware<Request,Response>[]) => NextConnect<Request,Response>} */
  function add(method, base, ...fns) {
    if (typeof base !== "string") return add(method, "*", base, ...fns);
    _add(/** @type {import("trouter").HTTPMethod} */ (method), base, ...fns);
    return nc;
  }
  /** 
   * @public
   * @template RequestExtra,ResponseExtra
   * @this NextConnect<Request,Response>
   * @type {(base: string | Middleware<Request & RequestExtra, Response & ResponseExtra>, ...fns: Middleware<Request & RequestExtra, Response & ResponseExtra>[]) => this} 
   */
  nc.use = function use(base, ...fns) {
    if (typeof base !== "string") return this.use("/", base, ...fns);
    if (base !== "/") {
      let slashAdded = false;
      fns.unshift((req, _, next) => {
        req.url = req.url.substring(base.length);
        if ((slashAdded = req.url[0] !== "/")) req.url = "/" + req.url;
        next();
      });
      fns.push(
        /** @type {Middleware<Request,Response>} */ ((req, _, next) =>
          (req.url = base + (slashAdded ? req.url.substring(1) : req.url)) &&
          next())
      );
    }
    _use(base, ...fns.map(mount));
    return nc;
  };
  /**
   * @public
   * @template 
   * @this NextConnect<Request,Response>
   * @type Request & RequestExtra, Response & ResponseExtra
   */
  nc.all = add.bind(nc, "");
  nc.get = add.bind(nc, "GET");
  nc.head = add.bind(nc, "HEAD");
  nc.post = add.bind(nc, "POST");
  nc.put = add.bind(nc, "PUT");
  nc.delete = add.bind(nc, "DELETE");
  nc.options = add.bind(nc, "OPTIONS");
  nc.trace = add.bind(nc, "TRACE");
  nc.patch = add.bind(nc, "PATCH");
  /** @public @type {(req: Request, res: Response) => Promise<void>} */
  nc.run = function run(req, res) {
    return new Promise((resolve, reject) => {
      this.handle(req, res, (err) => (err ? reject(err) : resolve()));
    });
  };
  /** @private @type {RequestHandler<Request,Response>} */
  nc.handle = function handle(req, res, done) {
    const idx = req.url.indexOf("?");
    const { handlers, params } = _find(
      req.method,
      idx !== -1 ? req.url.substring(0, idx) : req.url
    );
    if (attachParams) req.params = params;
    let i = 0;
    const len = handlers.length;
    /** @type {(next: NextFunction) => Promise<any>} */
    const loop = async (next) => handlers[i++](req, res, next);
    /** @type {NextFunction} */
    const next = (err) => {
      i < len
        ? err
          ? onError(err, req, res, next)
          : loop(next).catch(next)
        : done && done(err);
    };
    next();
  };
  return nc;
}
