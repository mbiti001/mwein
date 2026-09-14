"use client";

import { ComponentProps, useEffect, useMemo, useState } from "react";
import PharmacyWorkstation from "@/components/PharmacyWorkstation";
import InventoryWorkstation, { type StockFocus } from "@/components/InventoryWorkstation";
import SupplyWorkstation from "@/components/SupplyWorkstation";
import InventoryForecastPanel from "@/components/InventoryForecastPanel";

type PharmacyProps = ComponentProps<typeof PharmacyWorkstation>;
type Tab = "dispensing" | "inventory" | "forecast" | "receive" | "history" | "controls";

export default function PharmacyCenter({
  permissions,
  stockFocus,
  onStockFocusConsumed,
  ...pharmacyProps
}: PharmacyProps & {
  permissions: string[];
  stockFocus?: StockFocus | null;
  onStockFocusConsumed?: () => void;
}) {
  const tabs = useMemo(() => {
    const allowed: { key: Tab; label: string }[] = [];
    if (permissions.includes("pharmacy.dispense")) allowed.push({ key: "dispensing", label: "Dispensing" });
    if (permissions.includes("inventory.view")) {
      allowed.push({ key: "inventory", label: "Inventory" });
      allowed.push({ key: "forecast", label: "Forecast & reorder" });
    }
    if (permissions.includes("inventory.receive")) allowed.push({ key: "receive", label: "Receive stock" });
    if (permissions.includes("inventory.view")) allowed.push({ key: "history", label: "Movement history" });
    if (["inventory.count", "inventory.adjust", "inventory.transfer", "inventory.manage_stores", "procurement.create", "procurement.approve", "procurement.manage_suppliers"].some(permission => permissions.includes(permission)))
      allowed.push({ key: "controls", label: "Ordering & controls" });
    return allowed;
  }, [permissions]);
  const [tab, setTab] = useState<Tab>(stockFocus ? "inventory" : tabs[0]?.key || "inventory");

  useEffect(() => { if (stockFocus) setTab("inventory"); }, [stockFocus]);
  useEffect(() => { if (!tabs.some(item => item.key === tab) && tabs[0]) setTab(tabs[0].key); }, [tab, tabs]);

  return <>
    <nav className="workspaceTabs" aria-label="Pharmacy and stock sections">
      {tabs.map(item => <button className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)} key={item.key}>{item.label}</button>)}
    </nav>
    <div className="embeddedWorkspace pharmacyHub">
      {tab === "dispensing" && <PharmacyWorkstation {...pharmacyProps}/>} 
      {tab === "inventory" && <InventoryWorkstation permissions={permissions} focus={stockFocus} onFocusConsumed={onStockFocusConsumed}/>} 
      {tab === "forecast" && <InventoryForecastPanel/>}
      {tab === "receive" && <SupplyWorkstation permissions={permissions} view="receive"/>}
      {tab === "history" && <SupplyWorkstation permissions={permissions} view="history"/>}
      {tab === "controls" && <SupplyWorkstation permissions={permissions} view="controls"/>}
    </div>
  </>;
}
