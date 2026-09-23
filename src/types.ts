export interface ServiceItem {
    name: string;
    desc: string;
    url: string;
    icon: string;
    color: string;
    state?: string;
}

export interface Section {
    id: string;
    label: string;
    icon: string;
    items: ServiceItem[];
    adminOnly?: boolean;
}

export interface Container {
    id: string;
    name: string;
    state: string;
    status: string;
}

export interface ServerStats {
    cpu: number;
    memory: { total: number; used: number; percent: number };
    disk: { total: number; used: number; percent: number };
    uptime: number;
    load: { load1: number; load5: number; load15: number };
}
