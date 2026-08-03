# Redone SystemCore Blocks Interface

# Goals

- No prior knowledge necessary

Everything about the UI and the blocks themselves need to be usable by people as young as 6th grade without any programming experience.
Ideally, it should be as intuitive as Scratch or Spike Prime coding and require very little docs.
This means the interface needs to be fully understandable without a tutorial.

- The blocks experience is highest priority.

Converting blocks to text code should be readable and supported, but blocks coding experience should come first and foremost and should not be sacrificed for better converted code.

- Easy transition from FLL/Scratch

The interface should feel familiar to previous users of Scratch and FLL Spike Prime,
and the mental models should be preserved where possible.

For example, the color scheme should be the same, there should be direct equivalents for blocks where possible, etc.

# Non-Goals

- Support beyond MotionCore and a301.

For this initial proof of concept, attempting to support the huge range of devices that WPILib implements is unnecessary.
We can consider this after we have a basic workflow working.
Potential exception: maybe we can consider some support for common FTC things like color sensors or Pinpoint as helpers.

# Blockers

Wpilib Python Commandsv3 support is necessary for good async blocks.
We can do frontend work and planning without this but it would be really nice to have.

# Current prototype

The app has two project modes selected from **Robot Setup**:

- **Simple** is the beginner path: define motors once, then use their action
  blocks directly inside Teleop, Autonomous, and Utility OpModes.
- **Advanced** introduces commands3 subsystems. Each subsystem owns the A301
  motors selected in Robot Setup and appears as its own editor tab. Its
  Scratch-style event hats — `when this mechanism starts` and `when mechanism
command … is requested` — define reusable command groups. Mechanism editors
  also include the WPILib/REV sensor drawers and the generated RobotPy
  Extensions drawer, so sensor readings, waits, control flow, and custom API
  calls can live together in the mechanism. Sensors and named extension objects
  used by those blocks are wired into the generated mechanism automatically.
  OpModes schedule mechanism commands through a mechanism-and-command dropdown,
  so requirements are enforced by commands3.

OpModes remain separate tabs and each generates one decorated RobotPy class.
Their start hats run in parallel, while trigger hats remain active for the
duration of the OpMode. Projects are named, versioned browser snapshots with
download/import backup support.

Advanced RobotPy libraries are an escape hatch, not the primary workflow. Add
a named project object in **Libraries** and the API blocks target that object
from a dropdown instead of relying on a free-text `self...` target.
