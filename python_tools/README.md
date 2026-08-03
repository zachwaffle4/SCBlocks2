# Python Tools

This is the in-tree RobotPy metadata pipeline. It introspects the installed
RobotPy modules (wpilib, rev, ntcore, wpimath, …) and writes
`generated/robotpy_data.json`, the source of truth the TypeScript generators in
`../scripts` project into the block bindings.

Pipeline:

    RobotPy packages
      -> python_tools/generate_json.py            (this step)
      -> python_tools/generated/robotpy_data.json
      -> scripts/generate-api.mjs      -> src/generated/robotpy-api.ts  (escape hatch)
      -> scripts/generate-a301-api.mjs -> src/generated/a301.ts         (default toolbox)

The generated JSON is committed, so you only need to run this step when you want
to refresh the bindings against a newer RobotPy release.

## To regenerate `generated/robotpy_data.json`

The following instructions work on macOS Sonoma 14.6.1.

### Setup

    1. cd <your repo>/python_tools
    1. python3.12 -m venv ./venv
    1. source venv/bin/activate
    1. python3.12 -m pip install -r requirements.txt
    1. deactivate

### Regenerate

    1. cd <your repo>/python_tools
    1. source venv/bin/activate
    1. python3.12 generate_json.py --output_directory=.
    1. deactivate

That writes `./generated/robotpy_data.json` (and `./generated/runtime_python.json`).

### Then refresh the TypeScript bindings

    1. cd <your repo>
    1. npm run generate:api      # -> src/generated/robotpy-api.ts
    1. npm run generate:a301     # -> src/generated/a301.ts
