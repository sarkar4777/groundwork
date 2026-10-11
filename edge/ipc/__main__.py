"""python -m ipc, with GW_MACHINE (EX1, TC1, HT1, DZ1) and GW_ROLE (an ECU, controller or gateway)."""

import logging
import os
import sys

# a TCP read that splits a socketcand frame is normal, python-can warns on every one
logging.getLogger("can.interfaces.socketcand.socketcand").setLevel(logging.ERROR)


def main() -> None:
    machine = os.environ.get("GW_MACHINE", "EX1").upper()
    role = os.environ.get("GW_ROLE", "gateway").lower()
    from .machines import ROLES
    if role not in ROLES.get(machine, ()):
        sys.exit(f"{role} is not on {machine}'s bus, it carries {', '.join(ROLES.get(machine, ()))}")
    print(f"[{machine}/{role}] starting on {os.environ.get('CAN_INTERFACE', 'socketcand')} {os.environ.get('CAN_CHANNEL', 'vcan0')} at {os.environ.get('CAN_HOST', 'localhost')}", flush=True)
    if role == "gateway":
        from .gateway import Gateway
        Gateway(machine).run()
    elif role == "controller":
        from .frames import env_site
        env_site()
        from .controller import Controller
        Controller(machine).run()
    else:
        from .frames import env_site
        env_site()
        from .ecus import ECUS
        ECUS[role](machine).run()


if __name__ == "__main__":
    main()
