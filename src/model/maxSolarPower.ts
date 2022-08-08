import axios from "axios";

/*
export default async function controlMaxSolarPower(curValSmartMeter: CURRENT_IO_BROKER_VALUES) {
    if (curValSmartMeter.batteryStateOfCharge > 97 && curValSmartMeter.maxChargeCurrent > 10) {
        //reduce maxChargeCurrent to avoid constant loading and unloading..
        await axios.get(`http://192.168.178.81:8087/set/modbus.0.holdingRegisters.100.2705_Max-Charge_DVCC?value=10`);
    } else if (curValSmartMeter.batteryStateOfCharge < 90 && curValSmartMeter.maxChargeCurrent < 30) {
        await axios.get(`http://192.168.178.81:8087/set/modbus.0.holdingRegisters.100.2705_Max-Charge_DVCC?value=50`);
    }
}*/


export default async function setCurrentTargetValue(targetValue: number) {
    let newVal = targetValue * -1;
    if (newVal > 0 || newVal < -2000) {
        newVal = 0;
    }
    await axios.get(`http://192.168.178.81:8087/set/modbus.0.holdingRegisters.227.37_Ess_Setpoint?value=${newVal}`);
}

export async function disableOvervoltageFeedIn() {
    await axios.get(`http://192.168.178.81:8087/set/modbus.0.holdingRegisters.227.65_Overvoltage_Feed In?value=1`);
}
