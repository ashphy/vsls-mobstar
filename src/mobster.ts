import * as vscode from 'vscode';
import * as dayjs from 'dayjs';
import * as vsls from 'vsls';
import { Command } from './command';
import { Option } from './option';
import { UserInfo } from "vsls";

export class Mobster {
    statusBarItem: vscode.StatusBarItem;

    extensionId = 'vsls-mobster';

    readonly SERVICE_NAME = 'mobtimer';

    liveshare: vsls.LiveShare | null = null;
    hostService: vsls.SharedService | null | undefined = null;
    guestService: vsls.SharedServiceProxy | null | undefined = null;

    currentTimer: NodeJS.Timeout | null = null;

    // Host manage data
    members: UserInfo[] = [];
    memberIndex: number = -1;
    mobTimeIntervalSec = 10;
    startTime?: dayjs.Dayjs;

    // Guest manage data
    driverUser: UserInfo | undefined = undefined;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, Number.MIN_SAFE_INTEGER);
    }

    get driver() {
        if (this.isHost) {
            return this.members[this.memberIndex];
        } else {
            return this.driverUser;
        }
    };

    get isDriver() {
        return this.isMe(this.driver);
    }

    get me() {
        return this.liveshare?.session.user;
    }

    get isHost() {
        return !!this.hostService;
    };

    isMe = (user: UserInfo | undefined) => {
        return this.me?.id === user?.id;
    };

    async activate() {
        console.log('activate!');

        this.statusBarItem.show();
        this.statusBarItem.text = "Mobstar";
        this.statusBarItem.command = "vsls-mobster.openMobStar";

        this.liveshare = await vsls.getApi();
        console.log('live share', this.liveshare);

        this.liveshare?.onDidChangeSession((event) => {
            console.log('onDidChangeSession', event);
            if (event.session.access === vsls.Access.None) {
                console.log('reset session');
                this.resetSession();
            } else {
                console.log('register host/guest');
                if (event.session.role === vsls.Role.Host) {
                    this.registerHost();
                } else if (event.session.role === vsls.Role.Guest) {
                    this.registerGuest();
                }
            }
        });

        this.liveshare?.onPresenceProviderRegistered((event) => {
            console.log('onPresenceProviderRegistered', event);
        });

        this.liveshare?.onDidChangePeers((event) => {
            console.log('onDidChangePeers', event, this.liveshare?.peers);
            if (this.isHost) {
                event.added.forEach(element => {
                    if (element.user !== null) {
                        this.members.push();
                    }
                });

                this.members = this.members.filter((member) => {
                    const removedMember = event.removed.find((element) => {
                        return member.id === element.user?.id;
                    });
                    const isNotRemovedMember = (removedMember === undefined);
                    return isNotRemovedMember;
                });
            }

            console.log('Current Members', this.members);
        });

        if (this.liveshare?.onActivity) {
            this.liveshare.onActivity((event: any) => {
                console.log('onActivity', event);
            });
        }
    }

    askStart = () => {
        vscode.window.showInformationMessage(
            "Do you want to start the mob timer?",
            { modal: false },
            { title: "Start", isCloseAffordance: false },
            { title: "Cancel", isCloseAffordance: true }
        ).then((value) => {
            if (value?.title === 'Start') {
                console.log('confirmed start the timer', value);
                this.start();
            }
        });
    };

    start = async () => {
        console.log('start');

        console.log('api', this.liveshare);
        console.log('peer', this.liveshare?.peers);
        console.log('presenceProviders', this.liveshare?.presenceProviders);
        console.log('session', this.liveshare?.session);

        if (!this.liveshare) { return; }
        if (!this.liveshare.session) { return; }

        this.nextTurn();
    };

    nextTurn = () => {
        // Pick the next driver up
        this.memberIndex++;

        if (this.memberIndex < 0) {
            this.memberIndex = 0;
        }

        if (this.members.length <= this.memberIndex) {
            this.memberIndex = 0;
        }

        const currentMember = this.members[this.memberIndex];
        console.log('This turn is', currentMember);

        if (this.isHost) {
            this.onCmdTurnChange({ driver: currentMember });
        }

        this.notify(Command.cmdTurnChange, { driver: currentMember });
    };

    notify = (cmd: string, args: any) => {
        if (this.hostService) {
            this.hostService.notify(cmd, args);
        } else if (this.guestService) {
            this.guestService.notify(cmd, args);
        }
    };

    confirmDriver = () => {
        if (!this.me) { return; };

        this.startTime = dayjs();
        this.currentTimer = setInterval(this.tick, 1000);
        const option: Option = {
            driver: this.me,
            startTime: dayjs(),
            mobTimeIntervalSec: this.mobTimeIntervalSec
        };
        this.notify(Command.cmdStartTimer, option);
    };

    onCmdTurnChange = (args: any) => {
        console.log('onCmdTurnChange', args.driver);
        this.statusBarItem.text = `🛞 Waiting driver` ?? 'NULL';

        const driver = args.driver as UserInfo;
        this.driverUser = driver;

        if (this.isMe(driver)) {
            this.statusBarItem.backgroundColor = '#d68111';
            vscode.window.showInformationMessage(
                "Next Driver is you!",
                { modal: false },
                { title: "Continue", isCloseAffordance: false },
                { title: "Cancel", isCloseAffordance: true }
            ).then((value) => {
                if (value?.title === 'Continue') {
                    console.log('confirm driver', value);
                    this.confirmDriver();
                }
            });
        } else {
            // Color Change
        }
    };

    reCreateMember = () => {
        if (this.liveshare && this.liveshare?.session.user) {
            const user = [this.liveshare?.session.user];
            const peerUsers = this.liveshare?.peers.map((peer) => peer.user).filter(Boolean);
            this.members = user + peerUsers;
        }
    };

    onCmdStartTimer = (arg: any) => {
        const option = arg as Option;

        this.startTime = option.startTime;
        this.mobTimeIntervalSec = option.mobTimeIntervalSec;
        this.driverUser = option.driver;
        this.currentTimer = setInterval(this.tick, 1000);

        this.statusBarItem.text = `🛞 ${this.driver?.displayName} ${this.mobTimeIntervalSec}s` ?? 'NULL';
    };

    tick = async () => {
        // Display Timer
        const diff = dayjs().diff(this.startTime, "second");
        const remeins = this.mobTimeIntervalSec - diff;
        this.statusBarItem.text = `🛞 ${this.driver?.displayName} ${remeins.toString()}s` ?? 'NULL';

        // When turn change
        if (remeins <= 0) {
            if (this.currentTimer !== null) {
                clearInterval(this.currentTimer);
            }

            if (this.isHost) {
                this.nextTurn();
            }
        }
    };

    registerHost = async () => {
        this.hostService = await this.liveshare?.shareService(this.SERVICE_NAME);

        this.hostService?.onNotify(Command.cmdTurnChange, this.onCmdTurnChange);
        this.hostService?.onNotify(Command.cmdStartTimer, this.onCmdStartTimer);

        if (this.me) {
            this.members.push(this.me);
        }
    };

    registerGuest = async () => {
        this.guestService = await this.liveshare?.getSharedService(this.SERVICE_NAME);
        if (this.guestService?.isServiceAvailable) {
            this.guestService?.onNotify(Command.cmdStartTimer, this.onCmdStartTimer);
            this.guestService?.onNotify(Command.cmdTurnChange, this.onCmdTurnChange);
        } else {
            // たぶんホストに拡張が入っていない場合
            console.log('Guest service is not available');
        }
    };

    resetSession = () => {
        this.hostService = undefined;
        this.guestService = undefined;
        this.members = [];
    };
}