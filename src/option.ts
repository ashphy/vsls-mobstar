import dayjs = require("dayjs");
import { UserInfo } from "vsls";

export interface Option {
    driver: UserInfo;
    startTime: dayjs.Dayjs;
    mobTimeIntervalSec: number;
}