import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { pName } from "../lib/format";
import { Icon, ProviderIcon } from "./BrandSprite";
import { MorphText } from "./MorphText";

export interface ProviderTabOption {
  id: string;
  count: number;
}

export function ProviderTabs({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ProviderTabOption[];
  onChange: (provider: string) => void;
}) {
  return (
    <SegmentedControl
      className="provider-tabs"
      aria-label="Filter provider"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    >
      <SegmentedControlIndicator />
      {options.map((opt) => (
        <SegmentedControlItem
          key={opt.id}
          value={opt.id}
          data-filter={opt.id}
        >
          {opt.id === "all" ? (
            <Icon name="all" />
          ) : (
            <ProviderIcon provider={opt.id} />
          )}
          {opt.id === "all" ? "All" : pName(opt.id)}
          <span className="count">
            <MorphText text={opt.count} />
          </span>
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
