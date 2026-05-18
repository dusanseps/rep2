/**
 * Reusable upload helper with 409 conflict resolution
 * Handles file upload with conflict dialog workflow
 */

export async function uploadFileWithConflictHandler(options) {
  const {
    uploadUrl,
    file,
    onConflict,
    onError,
    onSuccess
  } = options;

  try {
    const fd = new FormData();
    fd.append('file', file);

    const resp = await fetch(uploadUrl, {
      method: 'POST',
      credentials: 'include',
      body: fd
    });

    if (resp.status === 409) {
      // File conflict detected
      const conflictData = await resp.json().catch(() => ({}));
      
      if (onConflict) {
        const action = await onConflict({
          existingName: conflictData.existingName || file.name,
          suggestedName: conflictData.suggestedName,
          code: conflictData.code
        });

        if (action.type === 'overwrite') {
          // Retry with overwrite parameter
          return uploadFileWithConflictHandler({
            uploadUrl: uploadUrl + '?overwrite=true',
            file,
            onConflict: null, // Don't show dialog again if it conflicts
            onError,
            onSuccess
          });
        } else if (action.type === 'rename') {
          // Create new file with renamed name
          const renamedFile = new File([file], action.newName, { type: file.type });
          // Retry with new filename
          const fd2 = new FormData();
          fd2.append('file', renamedFile);
          fd2.append('fileName', action.newName);

          const resp2 = await fetch(uploadUrl, {
            method: 'POST',
            credentials: 'include',
            body: fd2
          });

          if (resp2.ok) {
            onSuccess?.();
            return { success: true };
          } else {
            const err = await resp2.json().catch(() => ({ error: 'Chyba pri nahraní' }));
            onError?.(err.error || 'Chyba pri nahraní súboru');
            return { success: false };
          }
        } else {
          // Cancel
          return { success: false, cancelled: true };
        }
      }
      return { success: false };
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Chyba pri nahraní' }));
      onError?.(err.error || 'Chyba pri nahraní súboru');
      return { success: false };
    }

    onSuccess?.();
    return { success: true };
  } catch (err) {
    onError?.(err.message);
    return { success: false };
  }
}
