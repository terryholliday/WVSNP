'use client';

import React, { useState, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import { computeFileHash, formatHashForDisplay } from '@/lib/hash';

interface FileUploadProps {
  onFileSelect: (file: File, hash: string) => void;
  onUploadComplete: (file: File, hash: string, uploadUrl?: string) => void;
  acceptedTypes?: string;
  maxSizeMB?: number;
  label: string;
  required?: boolean;
  currentFile?: { name: string; hash: string; size: number };
}

export function FileUpload({
  onFileSelect,
  onUploadComplete,
  acceptedTypes = '.jpg,.jpeg,.png,.pdf',
  maxSizeMB = 10,
  label,
  required = false,
  currentFile
}: FileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string>('');
  const [isComputingHash, setIsComputingHash] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const validateFile = (file: File): string | null => {
    if (file.size > maxSizeBytes) {
      return `File size must be less than ${maxSizeMB}MB`;
    }

    const allowedExtensions = acceptedTypes.split(',').map(ext => ext.trim().toLowerCase());
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
      return `File type not allowed. Accepted types: ${acceptedTypes}`;
    }

    return null;
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError('');
    setUploadProgress(0);

    // Validate file
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSelectedFile(file);
    setIsComputingHash(true);

    try {
      // Compute SHA-256 hash (Chain of Custody - Step 1)
      const hash = await computeFileHash(file);
      setFileHash(hash);
      setIsComputingHash(false);

      // Display hash to user (Chain of Custody - Step 2)
      onFileSelect(file, hash);
    } catch (error) {
      console.error('Error computing file hash:', error);
      setError('Error processing file. Please try again.');
      setIsComputingHash(false);
      setSelectedFile(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !fileHash) return;

    setIsUploading(true);
    setError('');

    try {
      // Step 1: Request upload grant
      const grantResult = await apiClient.requestUploadGrant({
        applicationId: 'temp-app-id', // Would come from context
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        sizeBytes: selectedFile.size,
        actorId: 'temp-actor-id' // Would come from context
      });

      if (!grantResult.success) {
        throw new Error(grantResult.error?.message || 'Failed to get upload grant');
      }

      const grant = grantResult.data;

      // Step 2: Upload file to pre-signed URL (Chain of Custody - Step 3 & 4)
      const uploadSuccess = await apiClient.uploadFile(grant.uploadUrl, selectedFile);

      if (!uploadSuccess) {
        throw new Error('File upload failed');
      }

      // Step 3: Attach evidence to application
      const attachResult = await apiClient.attachEvidence({
        commandId: crypto.randomUUID(),
        applicationId: 'temp-app-id', // Would come from context
        evidenceRefId: grant.evidenceRefId,
        evidenceType: 'DOCUMENT', // Would be determined by upload type
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        sizeBytes: selectedFile.size,
        sha256: fileHash,
        storageKey: grant.storageKey,
        orgId: '550e8400-e29b-41d4-a716-446655440000', // WVSNP Program Org ID
        actorId: 'temp-actor-id', // Would come from context
        correlationId: crypto.randomUUID(),
        causationId: crypto.randomUUID(),
        occurredAt: new Date().toISOString()
      });

      if (!attachResult.success) {
        throw new Error(attachResult.error?.message || 'Failed to attach evidence');
      }

      setIsUploading(false);
      onUploadComplete(selectedFile, fileHash, grant.uploadUrl);

    } catch (error) {
      console.error('Upload error:', error);
      setError(error instanceof Error ? error.message : 'Upload failed. Please try again.');
      setIsUploading(false);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setFileHash('');
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
        <div className="text-center">
          {!selectedFile ? (
            <>
              <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="mt-4">
                <label htmlFor="file-upload" className="cursor-pointer">
                  <span className="mt-2 block text-sm font-medium text-gray-900">
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                  </span>
                  <span className="mt-1 block text-sm text-gray-600">
                    Click to upload or drag and drop
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {acceptedTypes.replace(/\./g, '').toUpperCase()} up to {maxSizeMB}MB
                  </span>
                </label>
                <input
                  id="file-upload"
                  name="file-upload"
                  type="file"
                  className="sr-only"
                  accept={acceptedTypes}
                  onChange={handleFileSelect}
                  ref={fileInputRef}
                  required={required && !currentFile}
                />
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* File Info */}
              <div className="flex items-center justify-center space-x-4">
                <div className="text-center">
                  <div className="text-sm font-medium text-gray-900">{selectedFile.name}</div>
                  <div className="text-sm text-gray-500">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
                <button
                  onClick={removeFile}
                  className="text-red-600 hover:text-red-800"
                  disabled={isComputingHash || isUploading}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Hash Display */}
              {fileHash && (
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-sm text-gray-700">
                    <strong>Document fingerprint:</strong> {formatHashForDisplay(fileHash)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    This unique code verifies your document's integrity
                  </div>
                </div>
              )}

              {/* Upload Button */}
              {fileHash && !isUploading && (
                <button
                  onClick={handleUpload}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Upload Document
                </button>
              )}

              {/* Upload Progress */}
              {isUploading && (
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <div className="text-sm text-center text-gray-600">
                    Uploading... {uploadProgress}%
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Computing Hash Indicator */}
      {isComputingHash && (
        <div className="flex items-center justify-center space-x-2 text-sm text-gray-600">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Processing document...</span>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </div>
      )}

      {/* Current File Display */}
      {currentFile && !selectedFile && (
        <div className="bg-green-50 border border-green-200 rounded p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-green-800">✓ {currentFile.name}</div>
              <div className="text-xs text-green-600">
                {(currentFile.size / 1024 / 1024).toFixed(2)} MB • Verified: {formatHashForDisplay(currentFile.hash)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
