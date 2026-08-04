"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export interface ComboboxOption {
  value: string
  label: string
}

/**
 * A searchable Select, built on the standard shadcn Popover+Command pattern
 * (there is no standalone "combobox" primitive in shadcn/ui). Pass
 * `onSearchChange` to filter server-side (for reference lists too large or
 * too dynamic to ever load in full - e.g. vendors, guests) rather than
 * relying on the caller loading every row up front behind a fixed page_size.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  onSearchChange,
  loading,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  className,
  disabled,
}: {
  options: ComboboxOption[]
  value: string
  onValueChange: (value: string) => void
  onSearchChange?: (search: string) => void
  loading?: boolean
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find(o => o.value === value)
  // cmdk's built-in filter (used only when we're not delegating search to the
  // server) matches typed text against each Item's `value` prop - so in local
  // mode that prop must be the human-readable label, not the id, or typing a
  // vendor's name would never match its numeric id. Resolve back to the real
  // id by label on select instead.
  const labelToValue = React.useMemo(() => new Map(options.map(o => [o.label, o.value])), [options])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={!onSearchChange}>
          <CommandInput placeholder={searchPlaceholder} onValueChange={onSearchChange} />
          <CommandList>
            <CommandEmpty>{loading ? "Searching..." : emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={onSearchChange ? option.value : option.label}
                  onSelect={currentValue => {
                    const resolved = onSearchChange ? currentValue : (labelToValue.get(currentValue) ?? currentValue)
                    onValueChange(resolved === value ? "" : resolved)
                    setOpen(false)
                  }}
                >
                  <Check className={cn("mr-2 size-4", value === option.value ? "opacity-100" : "opacity-0")} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
