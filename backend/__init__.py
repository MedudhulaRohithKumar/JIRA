"""CSR Work Flow Manager - Backend Package."""

import warnings
import starlette.routing as _sr
import starlette.middleware as _sm

warnings.filterwarnings("ignore", category=DeprecationWarning)

# Compatibility shim when FastAPI 0.104 runs alongside Starlette 1.x
_orig_router_init = _sr.Router.__init__


def _patched_router_init(self, *args, on_startup=None, on_shutdown=None, **kwargs):
    return _orig_router_init(self, *args, **kwargs)


_sr.Router.__init__ = _patched_router_init


def _patched_mw_iter(self):
    yield self.cls
    yield getattr(self, "kwargs", getattr(self, "options", {}))


_sm.Middleware.__iter__ = _patched_mw_iter
