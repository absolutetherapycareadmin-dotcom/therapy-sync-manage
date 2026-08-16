import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Baby,
  UserRound,
  DoorOpen,
  CalendarDays,
  ClipboardCheck,
  Package,
  IndianRupee,
  MessageCircle,
  PhoneCall,

  Bell,
  BarChart3,
  Settings,
  HeartPulse,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const groups = [
  {
    label: "Core",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Children", url: "/children", icon: Baby },
      { title: "Therapists", url: "/therapists", icon: UserRound },
      { title: "Rooms & Cabins", url: "/rooms", icon: DoorOpen },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Appointments", url: "/appointments", icon: CalendarDays },
      { title: "Attendance", url: "/attendance", icon: ClipboardCheck },
      { title: "Packages", url: "/packages", icon: Package },
      { title: "Payments", url: "/payments", icon: IndianRupee },
      { title: "WhatsApp Centre", url: "/whatsapp", icon: MessageCircle },
      { title: "Device SMS & Calls", url: "/device-comms", icon: PhoneCall },

    ],
  },
  {
    label: "System",
    items: [
      { title: "Notifications", url: "/notifications", icon: Bell },
      { title: "Reports", url: "/reports", icon: BarChart3 },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-1 py-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <HeartPulse className="size-5" />
          </span>
          {!collapsed && (
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">Therapy Care</span>
              <span className="text-xs text-muted-foreground">Clinic operations</span>
            </span>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = pathname === item.url || pathname.startsWith(`${item.url}/`);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url} onClick={() => setOpenMobile(false)}>
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
