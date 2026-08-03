export type A301ArgData = {
  name: string;
  type: string;
  defaultValue: string;
};

export type A301MethodData = {
  id: string;
  name: string;
  returnType: string;
  args: A301ArgData[];
  isCommon: boolean;
  tooltip: string;
};

export const A301_CLASS_NAME = 'rev.A301';
export const A301_MODULE_NAME = 'rev';

// Generated from RobotPy metadata for rev.A301. Regenerate with:
// npm run generate:a301 -- [path/to/robotpy_data.json]
export const A301_INSTANCE_METHODS: A301MethodData[] = [
  {id:"clearFaults",name:"clear_faults",returnType:"rev.REVLibError",args:[],isCommon:false,tooltip:"Clears all sticky faults."},
  {id:"disable",name:"disable",returnType:"None",args:[],isCommon:false,tooltip:"Common interface for disabling a motor."},
  {id:"getAbsoluteEncoderPosition",name:"get_absolute_encoder_position",returnType:"rev.Signal_double",args:[],isCommon:true,tooltip:"Get the absolute position of the motor. This returns the native units"},
  {id:"getAppliedOutput",name:"get_applied_output",returnType:"rev.Signal_double",args:[],isCommon:false,tooltip:"Returns the A301's output duty cycle."},
  {id:"getBusId",name:"get_bus_id",returnType:"int",args:[],isCommon:false,tooltip:"Get the configured CAN Bus ID of the FIRST A301."},
  {id:"getBusVoltage",name:"get_bus_voltage",returnType:"rev.Signal_double",args:[],isCommon:false,tooltip:"Returns the voltage fed into the A301."},
  {id:"getDeviceId",name:"get_device_id",returnType:"int",args:[],isCommon:false,tooltip:"Get the configured Device ID of the FIRST A301."},
  {id:"getEncoderVelocity",name:"get_encoder_velocity",returnType:"rev.Signal_double",args:[],isCommon:true,tooltip:"Get the velocity of the motor. This returns the native units"},
  {id:"getFaults",name:"get_faults",returnType:"rev.Signal_A301Faults",args:[],isCommon:false,tooltip:"Get the active faults that are currently present on the A301. Faults"},
  {id:"getFirmwareString",name:"get_firmware_string",returnType:"str",args:[],isCommon:false,tooltip:"Get the firmware version of the FIRST A301 as a string."},
  {id:"getFirmwareVersion",name:"get_firmware_version",returnType:"int",args:[],isCommon:false,tooltip:"Get the firmware version of the FIRST A301."},
  {id:"getFirmwareVersion_tuple_int_bool",name:"get_firmware_version",returnType:"tuple[int, bool]",args:[],isCommon:false,tooltip:""},
  {id:"getInverted",name:"get_inverted",returnType:"bool",args:[],isCommon:false,tooltip:"Common interface for getting the inversion state of the motor controller."},
  {id:"getMotorCurrent",name:"get_motor_current",returnType:"rev.Signal_double",args:[],isCommon:false,tooltip:"Returns A301's motor current in Amps."},
  {id:"getMotorTemperature",name:"get_motor_temperature",returnType:"rev.Signal_double",args:[],isCommon:false,tooltip:"Returns the motor temperature in Celsius."},
  {id:"getRelativeEncoderPosition",name:"get_relative_encoder_position",returnType:"rev.Signal_double",args:[],isCommon:true,tooltip:"Get the position of the motor. This returns the native units"},
  {id:"getStickyFaults",name:"get_sticky_faults",returnType:"rev.Signal_A301Faults",args:[],isCommon:false,tooltip:"Get the sticky faults that were present on the A301 at one point"},
  {id:"getStickyWarnings",name:"get_sticky_warnings",returnType:"rev.Signal_A301Warnings",args:[],isCommon:false,tooltip:"Get the sticky warnings that were present on the A301 at one point"},
  {id:"getThrottle",name:"get_throttle",returnType:"float",args:[],isCommon:true,tooltip:"Gets the throttle of the motor controller."},
  {id:"getWarnings",name:"get_warnings",returnType:"rev.Signal_A301Warnings",args:[],isCommon:false,tooltip:"Get the active warnings that are currently present on the A301."},
  {id:"hasActiveFault",name:"has_active_fault",returnType:"rev.Signal_bool",args:[],isCommon:false,tooltip:""},
  {id:"hasActiveWarning",name:"has_active_warning",returnType:"rev.Signal_bool",args:[],isCommon:false,tooltip:"Get whether the A301 has one or more active warnings."},
  {id:"hasStickyFault",name:"has_sticky_fault",returnType:"rev.Signal_bool",args:[],isCommon:false,tooltip:"Get whether the A301 has one or more sticky faults."},
  {id:"hasStickyWarning",name:"has_sticky_warning",returnType:"rev.Signal_bool",args:[],isCommon:false,tooltip:"Get whether the A301 has one or more sticky warnings."},
  {id:"setAbsolutePosition",name:"set_absolute_position",returnType:"rev.REVLibError",args:[{name:"abs_position",type:"float",defaultValue:""},{name:"is_continuous",type:"bool",defaultValue:""}],isCommon:true,tooltip:"Sets the absolute position of the A301 with optional continuous rotation."},
  {id:"setCurrent",name:"set_current",returnType:"rev.REVLibError",args:[{name:"current",type:"float",defaultValue:""}],isCommon:false,tooltip:"Sets the motor current of the A301."},
  {id:"setInverted",name:"set_inverted",returnType:"None",args:[{name:"is_inverted",type:"bool",defaultValue:""}],isCommon:true,tooltip:"Common interface for setting the inversion state of the motor controller."},
  {id:"setPosition",name:"set_position",returnType:"rev.REVLibError",args:[{name:"position",type:"float",defaultValue:""}],isCommon:true,tooltip:"Sets the relative position of the A301."},
  {id:"setRelativeEncoderPosition",name:"set_relative_encoder_position",returnType:"rev.REVLibError",args:[{name:"position",type:"float",defaultValue:""}],isCommon:true,tooltip:"Set the position of the relative encoder."},
  {id:"setThrottle",name:"set_throttle",returnType:"None",args:[{name:"throttle",type:"float",defaultValue:""}],isCommon:true,tooltip:"Sets the throttle of the motor controller."},
  {id:"setVelocity",name:"set_velocity",returnType:"rev.REVLibError",args:[{name:"velocity",type:"float",defaultValue:""}],isCommon:true,tooltip:"Sets the velocity of the A301."},
  {id:"setVoltage",name:"set_voltage",returnType:"None",args:[{name:"output",type:"wpimath.units.volts",defaultValue:""}],isCommon:false,tooltip:"Sets the voltage output of the SpeedController. The behavior of"},
];

export const getA301Method = (id: string) =>
  A301_INSTANCE_METHODS.find((method) => method.id === id) ||
  A301_INSTANCE_METHODS[0];

export const labelForA301Method = (method: A301MethodData) => {
  const argLabel = method.args.map((arg) => arg.name).join(', ');
  const commonPrefix = method.isCommon ? 'Common: ' : '';
  return `${commonPrefix}${method.name}(${argLabel}) -> ${method.returnType}`;
};

export const a301MethodOptions = (methods = A301_INSTANCE_METHODS) =>
  methods.map((method) => [labelForA301Method(method), method.id]);

export const A301_VALUE_METHODS = A301_INSTANCE_METHODS.filter(
  (method) => method.returnType !== 'None',
);
