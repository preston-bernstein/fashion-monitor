import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import type { Role, UsersResponse } from "@fm/shared/dto.js";
import { PageHeader, RequireCapability, LoadingPage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ROLE_VALUES = ["owner", "admin", "curator", "operator", "viewer"] as const;

const createUserSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(ROLE_VALUES),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

export function UsersPage() {
  return (
    <RequireCapability capability="users:manage">
      <UsersContent />
    </RequireCapability>
  );
}

function UsersContent() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<UsersResponse>("/api/users"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) =>
      apiPatch(`/api/users/${id}/role`, { role }),
    onSuccess: () => {
      toast.success("Role updated");
      invalidate();
    },
    onError: (e: ApiError) => {
      toast.error(e.message);
      invalidate();
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "active" | "disabled" }) =>
      apiPatch(`/api/users/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("Status updated");
      invalidate();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (isLoading || !data) return <LoadingPage />;

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage members and their roles in this workspace."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Add user
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Select
                      value={u.role}
                      onValueChange={(role) => setRole.mutate({ id: u.id, role: role as Role })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {data.roles.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "success" : "secondary"}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setStatus.mutate({
                          id: u.id,
                          status: u.status === "active" ? "disabled" : "active",
                        })
                      }
                    >
                      {u.status === "active" ? "Disable" : "Enable"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateUserDialog
        open={creating}
        roles={data.roles}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false);
          invalidate();
        }}
      />
    </>
  );
}

function CreateUserDialog({
  open,
  roles,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  roles: { value: Role; label: string }[];
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: "", password: "", role: "viewer" },
  });

  const create = useMutation({
    mutationFn: (v: CreateUserValues) => apiPost("/api/users", v),
    onSuccess: () => {
      toast.success("User created");
      form.reset({ email: "", password: "", role: "viewer" });
      onCreated();
    },
    onError: (e: ApiError) => {
      if (e.code === "duplicate") form.setError("email", { message: e.message });
      else toast.error(e.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>Create a member with an initial password and role.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => create.mutate(v))}>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                Create user
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
