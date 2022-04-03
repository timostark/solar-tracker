import axios from "axios";

export async function getIOBrokerValues() {
    let values = ["modbus.0.inputRegisters.226.789_Solar_Charger Power", //solar power
                "modbus.0.inputRegisters.100.843_Battery_State of Charge", //% available
                "modbus.0.inputRegisters.225.261_Battery_Current", //battery current
                "modbus.0.inputRegisters.225.259_Battery_voltage", //battery voltage
                "modbus.0.inputRegisters.100.860_DC_System Power", //additional dc output
                "smartmeter.0.1-0:16_7_0__255.value", //overall usage in the house,
                "0_userdata.0.internal.ae_internal_measure_day", //current measure day
                "0_userdata.0.internal.ae_internal_measure_used_avg", //current measure day
                "0_userdata.0.internal.ae_internal_measure_count", //current count
            ];
    const response = await axios.get('http://192.168.178.81:8087/getBulk/' + values.join(",") );

    let resp = response.data;

    const solarPower = resp.find((e: any) => e.id === "modbus.0.inputRegisters.226.789_Solar_Charger Power" )?.val || 0;
    const batteryStateOfCharge = resp.find((e: any) => e.id === "modbus.0.inputRegisters.100.843_Battery_State of Charge" )?.val || 0;
    const batteryCurrent = resp.find((e: any) => e.id === "modbus.0.inputRegisters.225.261_Battery_Current" )?.val || 0;
    const batteryVoltage = resp.find((e: any) => e.id === "modbus.0.inputRegisters.225.259_Battery_voltage" )?.val || 0;
    const additionalDcOutput = resp.find((e: any) => e.id === "modbus.0.inputRegisters.100.860_DC_System Power" )?.val || 0;
    const overallUsage = resp.find((e: any) => e.id === "smartmeter.0.1-0:16_7_0__255.value" )?.val || 0;
    const currentDay = resp.find((e: any) => e.id === "0_userdata.0.internal.ae_internal_measure_day" )?.val || "";
    const currentAvg = resp.find((e: any) => e.id === "0_userdata.0.internal.ae_internal_measure_used_avg" )?.val || 0.0;
    const currentCount = resp.find((e: any) => e.id === "0_userdata.0.internal.ae_internal_measure_count" )?.val || 0;

    return {
        batteryStateOfCharge: batteryStateOfCharge,
        solarPower: solarPower,
        batteryPower: batteryCurrent * batteryVoltage,
        dcPower: additionalDcOutput,
        overallUsedPower: overallUsage,
        currentAvg: currentAvg,
        currentCount: currentCount,
        currentDay: currentDay
    };
}

