"""The J1939 dictionary the PCs speak. It is the twin's own, so the twin decodes a PC's frames with the same code.

The messages a machine's onboard network adds (setpoints, safety commands, task transfer, site GNSS) are defined
in twin/j1939.py beside the vECU PGNs, in proprietary B from group extension 0x30.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# the twin's encoder ships beside this package in the image, or sits in the repo during development
_here = Path(__file__).resolve()
for cand in (_here.parent.parent / "twin_lib", _here.parents[2] / "abenix" / "code-assets" / "gw-site-twin"):
    if (cand / "twin" / "j1939.py").exists() and str(cand) not in sys.path:
        sys.path.insert(0, str(cand))
        break

from twin import j1939 as J  # noqa: E402
from twin import layout as L  # noqa: E402
from twin.j1939 import (  # noqa: E402,F401
    ACKM, ADDRESS_CLAIMED, CI, CMD_FAULT, CMD_HOLD, CMD_MODE, CMD_TASK, CRN1, DRV1, GNSS1, GNSS2, GWHB1, MODE_CODE, MODES,
    PROP_A, REQUEST, SA, SOFT, TASK_CODE, TASK_STATES, TSC1, TSTAT1, XCMD1,
)


def env_site() -> str:
    return L.use(os.environ.get("GW_SITE", "northgate"))
