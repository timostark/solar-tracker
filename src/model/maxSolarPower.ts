import axios from "axios";
import { CURRENT_SMART_METER_VALUES } from "./AEConversion";
import { CURRENT_IO_BROKER_VALUES } from "./IOBroker";


export default async function controlMaxSolarPower(curAEConversionValues: CURRENT_SMART_METER_VALUES, curValSmartMeter: CURRENT_IO_BROKER_VALUES) {
    if ( curValSmartMeter.batteryStateOfCharge > 97 && curValSmartMeter.maxChargeCurrent > 10 ) {
        //reduce maxChargeCurrent to avoid constant loading and unloading..
        await axios.get(`http://192.168.178.81:8087/set/modbus.0.holdingRegisters.100.2705_Max-Charge_DVCC?value=10`);
    } else if ( curValSmartMeter.batteryStateOfCharge < 90 && curValSmartMeter.maxChargeCurrent < 30 ) {
        await axios.get(`http://192.168.178.81:8087/set/modbus.0.holdingRegisters.100.2705_Max-Charge_DVCC?value=50`);
    }
}
