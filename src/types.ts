export interface ServiceItem {
    name: string;
    desc: string;
    url: string;
    icon: string;
    color: string;
}

export interface Section {
    id: string;
    label: string;
    icon: string;
    items: ServiceItem[];
}

export interface Container {
    id: string;
    name: string;
    state: string;
    status: string;
    image: string;
}
