import { cn } from "@/lib/utils";
import * as TabsPrimitive from "@radix-ui/react-tabs";

const Tabs = TabsPrimitive.Root;

interface ITabsTriggerList
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  className?: string;
}
const TabsTriggerList = ({
  children,
  className,
  ...props
}: ITabsTriggerList) => {
  return (
    <TabsPrimitive.List
      className={cn("flex flex-row space-x-2 w-full", className)}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  );
};

interface ITabsTrigger
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  className?: string;
}
const TabsTrigger = ({ children, className, ...props }: ITabsTrigger) => {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "px-4 py-1 rounded-full border border-transparent data-[state=active]:border-transparent data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:font-semibold focus:outline-hidden",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
};

interface ITabsContent
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> {
  className?: string;
}
const TabsContent = ({ children, className, ...props }: ITabsContent) => {
  return (
    <TabsPrimitive.Content
      className={cn("border border-border rounded-[20px] mt-2 p-4 w-full", className)}
      {...props}
    >
      {children}
    </TabsPrimitive.Content>
  );
};

const TabsObj = Object.assign(Tabs, {
  Trigger: TabsTrigger,
  Content: TabsContent,
  List: TabsTriggerList,
});

export { TabsObj as Tabs };
