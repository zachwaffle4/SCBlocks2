// @blockly/field-colour ships a prebuilt UMD bundle that statically requires
// blockly/javascript, blockly/dart, blockly/lua and blockly/php so it can
// register colour-block generators for every language Blockly supports. This app
// only ever generates Python, so those four generators were ~140 kB of dead
// weight in the client bundle.
//
// vite.config.ts aliases those four entry points to this stub. Registration
// still succeeds — it just writes into a throw-away generator — while the real
// blockly/core and blockly/python stay untouched.

const generatorStub = () => ({
  forBlock: {},
  // Anything reading a precedence constant gets a number rather than undefined.
  ORDER_ATOMIC: 0,
});

// Order is consulted as Order.ATOMIC, Order.FUNCTION_CALL, and so on.
export const Order = new Proxy({}, { get: () => 0 });

export const javascriptGenerator = generatorStub();
export const dartGenerator = generatorStub();
export const luaGenerator = generatorStub();
export const phpGenerator = generatorStub();

export default {
  Order,
  javascriptGenerator,
  dartGenerator,
  luaGenerator,
  phpGenerator,
};
