import {
  Bot,
  Boxes,
  Calculator,
  CalendarRange,
  ChartColumn,
  CircleDollarSign,
  ClipboardList,
  Gauge,
  GitBranch,
  Landmark,
  LayoutDashboard,
  Rocket,
  Settings,
  Shield,
  ShoppingCart,
  Warehouse,
  Workflow,
  type LucideIcon,
} from "lucide-react";

// Sidebar groups, labels, order and hrefs (SPEC FR-011, FR-012).
// Only "/" has a page in this rebuild; the other hrefs are plain links (FR-012).

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV: readonly NavGroup[] = [
  {
    group: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/ai-cockpit", label: "AI & HITL Cockpit", icon: Bot },
    ],
  },
  {
    group: "Sales & Planning",
    items: [
      { href: "/orders", label: "Sales Orders", icon: ClipboardList },
      { href: "/sop", label: "S&OP Planning", icon: ChartColumn },
    ],
  },
  {
    group: "Inventory & Supply",
    items: [
      { href: "/supply", label: "Supply Explorer", icon: GitBranch },
      { href: "/replenishment", label: "Replenishment", icon: ShoppingCart },
      { href: "/purchasing", label: "Purchasing", icon: CircleDollarSign },
      { href: "/warehouse", label: "Warehousing", icon: Warehouse },
    ],
  },
  {
    group: "Production",
    items: [
      { href: "/production", label: "Prod Orders", icon: Boxes },
      { href: "/gantt", label: "Schedule & Simulate", icon: CalendarRange },
      { href: "/capacity", label: "Capacity", icon: Gauge },
      { href: "/costing", label: "Product Costing", icon: Calculator },
    ],
  },
  {
    group: "Finance",
    items: [
      { href: "/finance", label: "Financial Control Center", icon: Landmark },
      { href: "/finance-ops", label: "Finance Ops & Automation", icon: Workflow },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/admin", label: "Admin Center", icon: Shield },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/releases", label: "Releases & Upgrades", icon: Rocket },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV.flatMap((g) => g.items);
