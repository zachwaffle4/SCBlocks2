// RobotPy 2027.0.0a6.post4 renamed the whole API surface from camelCase to
// snake_case, so the catalogs projected out of the (older, camelCase) metadata
// in python_tools/generated/robotpy_data.json have to be lowered on the way in.
//
// Keep this in sync with snakeCase() in src/pythonNaming.ts — the build scripts
// are plain .mjs and cannot import the TypeScript copy.
//
// Validated against the real post1 -> post4 rename by comparing dir() for every
// wpilib/wpimath/wpiutil/ntcore class in both releases: 3126 of 3135 renamed
// members match. The known misses are voltage-rail and vendor-acronym names
// outside this app's scope (get5VRegulatedVoltage, getCurrent3V3,
// getDefaultCTREPCMModule, setFloatOn0).
export const snakeCase = (value) =>
  value
    // Upstream treats "OpMode" as a single word: getOpMode -> get_opmode.
    .replace(/OpMode/g, 'Opmode')
    // Keep a plural "s" attached to an acronym: getPOVsAvailable ->
    // get_povs_available, setLEDs -> set_leds.
    .replace(/([A-Z]{2,}[0-9]*)s(?=[A-Z]|$)/g, '$1S')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    // Split a digit from a following word, but not inside an acronym, so
    // getLeftPaddle1Button -> get_left_paddle1_button and getI2CPort ->
    // get_i2c_port.
    .replace(/(?<![A-Z])([0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z][A-Z0-9]*)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

// Data members also lose the C++ "k" prefix, but attributes stay lowercase:
// wpimath.units.kInchesPerFoot -> inches_per_foot,
// DifferentialDriveFeedforward.kAAngular -> a_angular. Only dropped when a
// letter follows, so numeric REV members (k1000ms, k18x) stay valid Python
// identifiers.
const dropKPrefix = (value) => value.replace(/^k(?=[A-Za-z])/, '');

export const attributeName = (value) => snakeCase(dropKPrefix(value));

// post4 also restyled enum values and constants as SCREAMING_SNAKE_CASE and
// dropped the C++ "k" prefix: kThrottleAxis -> THROTTLE_AXIS, kL2 -> L2.
// Already-screaming values (PORT_0, FLAT) pass through unchanged.
//
// Validated the same way as snakeCase(): 224 of 228 enum values across
// wpilib/wpimath/wpiutil/ntcore match. The 4 misses are the Gamepad.Button
// compass-point rename (SOUTH_FACE -> FACE_DOWN), which is a rename rather than
// a restyling.
export const screamingSnakeCase = (value) => attributeName(value).toUpperCase();
