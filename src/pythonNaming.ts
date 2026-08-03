/**
 * RobotPy 2027.0.0a6.post4 renamed the whole API surface from camelCase to
 * snake_case (commands3 depends on post4, so it is already snake_case). Block
 * field values that were saved before that switch — gamepad button/axis stems,
 * extension method labels — still hold CamelCase names, so they are lowered
 * here on the way into generated Python instead of being migrated on disk.
 *
 * Keep this in sync with scripts/python-naming.mjs, which applies the same
 * transform when projecting the generated API catalogs. Already-snake_case
 * input passes through unchanged, so applying this twice is safe.
 */
export const snakeCase = (value: string) =>
  value
    // Upstream treats "OpMode" as a single word: getOpMode -> get_opmode.
    .replace(/OpMode/g, 'Opmode')
    // Keep a plural "s" attached to an acronym: setLEDs -> set_leds.
    .replace(/([A-Z]{2,}[0-9]*)s(?=[A-Z]|$)/g, '$1S')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    // Split a digit from a following word, but not inside an acronym, so
    // LeftPaddle1Button -> left_paddle1_button and getI2CPort -> get_i2c_port.
    .replace(/(?<![A-Z])([0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z][A-Z0-9]*)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

/**
 * post4 restyled enum values and constants as SCREAMING_SNAKE_CASE and dropped
 * the C++ "k" prefix: kThrottleAxis -> THROTTLE_AXIS, kL2 -> L2. Values that are
 * already screaming (PORT_0, FLAT) pass through unchanged, so this is safe to
 * apply to labels saved either side of the switch. A "k" prefix is only
 * dropped when a letter follows, so numeric REV members (k1000ms, k18x) stay
 * valid Python identifiers: K1000MS, K18X.
 */
export const screamingSnakeCase = (value: string) =>
  snakeCase(value.replace(/^k(?=[A-Za-z])/, '')).toUpperCase();
