import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api, getApiErrorMessage } from "@/lib/api";
import { showToast } from "@/lib/toast";

export type AsyncTaskStatus = "queued" | "processing" | "running" | "success" | "failed";

export type AsyncTask<TPayload = unknown> = {
  id: string;
  device_id?: string;
  action?: string;
  status: AsyncTaskStatus | string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  message?: string;
  error?: string;
  response_code?: number;
  response_body?: string;
  attempts?: number;
  payload?: TPayload;
};

type AsyncTaskActionResponse = {
  success?: boolean;
  message?: string;
  task?: {
    id: string;
    status?: string;
    created_at?: string;
  };
};

type AsyncTaskPollingOptions<TPayload> = {
  path: string;
  taskId?: string;
  enabled?: boolean;
  pollInterval?: number;
} & Omit<UseQueryOptions<AsyncTask<TPayload>>, "queryKey" | "queryFn" | "enabled" | "refetchInterval">;

type AsyncTaskTriggerOptions<TPayload, TResponse extends AsyncTaskActionResponse> = {
  taskStatusPath?: string;
  pollInterval?: number;
  queuedTitle?: string;
  successTitle?: string;
  errorTitle?: string;
  onSuccess?: (task: AsyncTask<TPayload>, response?: TResponse) => void;
  onError?: (task: AsyncTask<TPayload>, response?: TResponse) => void;
};

type AsyncTaskTriggerResult<TPayload, TTriggerPayload, TResponse extends AsyncTaskActionResponse> = {
  trigger: (payload?: TTriggerPayload) => Promise<TResponse>;
  taskId: string | null;
  task: AsyncTask<TPayload> | undefined;
  response: TResponse | undefined;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  errorMessage: string | null;
  reset: () => void;
  mutation: UseMutationResult<TResponse, unknown, TTriggerPayload | undefined>;
};

function deriveTaskStatusPath(endpoint: string) {
  return endpoint.startsWith("/mikrotik/") ? "/mikrotik/tasks" : "/acs/tasks";
}

export function useAsyncTask<TPayload = unknown>(
  options: AsyncTaskPollingOptions<TPayload>,
): UseQueryResult<AsyncTask<TPayload>>;
export function useAsyncTask<
  TPayload = unknown,
  TTriggerPayload = unknown,
  TResponse extends AsyncTaskActionResponse = AsyncTaskActionResponse,
>(
  taskEndpoint: string,
  options?: AsyncTaskTriggerOptions<TPayload, TResponse>,
): AsyncTaskTriggerResult<TPayload, TTriggerPayload, TResponse>;
export function useAsyncTask<
  TPayload = unknown,
  TTriggerPayload = unknown,
  TResponse extends AsyncTaskActionResponse = AsyncTaskActionResponse,
>(
  endpointOrOptions: string | AsyncTaskPollingOptions<TPayload>,
  triggerOptions?: AsyncTaskTriggerOptions<TPayload, TResponse>,
) {
  const isTriggerMode = typeof endpointOrOptions === "string";
  const [taskId, setTaskId] = useState<string | null>(null);
  const [response, setResponse] = useState<TResponse>();
  const handledStateRef = useRef<string | null>(null);

  const pollingOptions: AsyncTaskPollingOptions<TPayload> = isTriggerMode
    ? { path: "", enabled: false }
    : endpointOrOptions;

  const taskStatusPath = isTriggerMode
    ? triggerOptions?.taskStatusPath ?? deriveTaskStatusPath(endpointOrOptions)
    : pollingOptions.path;
  const pollInterval = isTriggerMode
    ? (triggerOptions?.pollInterval ?? 2_000)
    : (pollingOptions.pollInterval ?? 3_000);
  const resolvedTaskId = isTriggerMode ? taskId : pollingOptions.taskId;
  const enabled = isTriggerMode
    ? Boolean(resolvedTaskId)
    : (pollingOptions.enabled ?? true) && Boolean(resolvedTaskId);

  const taskQuery = useQuery({
    queryKey: ["async-task", taskStatusPath, resolvedTaskId],
    enabled,
    refetchInterval: (query) => {
      const task = query.state.data;
      return task && ["success", "failed"].includes(task.status) ? false : pollInterval;
    },
    queryFn: async () => {
      const { data } = await api.get<AsyncTask<TPayload>>(`${taskStatusPath}/${resolvedTaskId}`);
      return data;
    },
    ...(isTriggerMode ? {} : pollingOptions),
  });

  const mutation = useMutation<TResponse, unknown, TTriggerPayload | undefined>({
    mutationFn: async (payload) => {
      if (!isTriggerMode) {
        throw new Error("trigger is only available when useAsyncTask is called with a task endpoint");
      }

      const { data } = await api.post<TResponse>(endpointOrOptions, payload);
      return data;
    },
    onSuccess: (nextResponse) => {
      if (!isTriggerMode) {
        return;
      }

      setResponse(nextResponse);
      const nextTaskId = nextResponse.task?.id ?? null;
      setTaskId(nextTaskId);
      handledStateRef.current = null;

      showToast({
        title: triggerOptions?.queuedTitle ?? nextResponse.message ?? "Task queued...",
        variant: "default",
      });
    },
    onError: (error) => {
      if (!isTriggerMode) {
        return;
      }

      showToast({
        title: triggerOptions?.errorTitle ?? "Task failed",
        description: getApiErrorMessage(error),
        variant: "error",
      });
    },
  });

  useEffect(() => {
    if (!isTriggerMode || !taskQuery.data || !resolvedTaskId) {
      return;
    }

    const statusKey = `${resolvedTaskId}:${taskQuery.data.status}`;
    if (handledStateRef.current === statusKey) {
      return;
    }

    if (taskQuery.data.status === "success") {
      handledStateRef.current = statusKey;
      showToast({
        title: triggerOptions?.successTitle ?? response?.message ?? "Task completed",
        variant: "success",
      });
      triggerOptions?.onSuccess?.(taskQuery.data, response);
      return;
    }

    if (taskQuery.data.status === "failed") {
      handledStateRef.current = statusKey;
      showToast({
        title: triggerOptions?.errorTitle ?? "Task failed",
        description: taskQuery.data.error ?? response?.message,
        variant: "error",
      });
      triggerOptions?.onError?.(taskQuery.data, response);
    }
  }, [isTriggerMode, resolvedTaskId, response, taskQuery.data, triggerOptions]);

  const result = useMemo<AsyncTaskTriggerResult<TPayload, TTriggerPayload, TResponse>>(
    () => ({
      trigger: async (payload) => mutation.mutateAsync(payload),
      taskId,
      task: taskQuery.data,
      response,
      isPending:
        mutation.isPending ||
        (taskQuery.data !== undefined && !["success", "failed"].includes(taskQuery.data.status)),
      isSuccess: taskQuery.data?.status === "success",
      isError: mutation.isError || taskQuery.data?.status === "failed",
      errorMessage:
        mutation.isError ? getApiErrorMessage(mutation.error) : taskQuery.data?.status === "failed" ? taskQuery.data.error ?? null : null,
      reset: () => {
        setTaskId(null);
        setResponse(undefined);
        handledStateRef.current = null;
      },
      mutation,
    }),
    [mutation, response, taskId, taskQuery.data],
  );

  return isTriggerMode ? result : taskQuery;
}
