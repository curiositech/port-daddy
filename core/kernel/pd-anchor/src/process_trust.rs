//! Live-process trust verification for the FleetBar enrollment helper.
//!
//! The daemon passes only the PID returned by `posix_spawn`/`spawn`. The exact
//! FleetBar identity requirement is compiled into this Rust boundary; callers
//! cannot weaken it by supplying a path, requirement, team ID, or entitlement
//! policy. Static path validation is deliberately insufficient because a path
//! can be swapped after inspection while a different process is already
//! connected to the daemon's private pipes.

use serde::Serialize;
use thiserror::Error;

/// This must remain byte-for-byte aligned with FleetBar's release identity.
/// Notarization, hardened-runtime, and unsafe-entitlement checks are separate
/// gates below so a future requirement edit cannot accidentally erase them.
pub const FLEETBAR_DESIGNATED_REQUIREMENT: &str =
    "anchor apple generic and identifier \"ai.portdaddy.FleetBar\" and certificate leaf[subject.OU] = \"P5H9P59X2M\" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists";

#[cfg(any(target_os = "macos", test))]
const CS_VALID: u64 = 0x0000_0001;
#[cfg(any(target_os = "macos", test))]
const CS_GET_TASK_ALLOW: u64 = 0x0000_0004;
#[cfg(any(target_os = "macos", test))]
const CS_RUNTIME: u64 = 0x0001_0000;
#[cfg(any(target_os = "macos", test))]
const CS_DEBUGGED: u64 = 0x1000_0000;

#[derive(Clone, Debug, Error, PartialEq, Eq, Serialize)]
pub enum ProcessTrustError {
    #[error("FleetBar helper PID must be a positive process identifier")]
    InvalidPid,
    #[error("FleetBar helper process does not exist or exited during verification")]
    ProcessUnavailable,
    #[error("FleetBar helper does not satisfy the compiled-in production identity")]
    IdentityMismatch,
    #[error("FleetBar helper does not satisfy Apple's notarization requirement")]
    NotarizationRequired,
    #[error("FleetBar helper is not running with hardened-runtime enforcement")]
    HardenedRuntimeRequired,
    #[error("FleetBar helper was debugged or carries get-task-allow")]
    DebugPrivilegeRefused,
    #[error("FleetBar helper carries an unsafe code-signing entitlement: {0}")]
    UnsafeEntitlement(&'static str),
    #[error("FleetBar helper inherited an unsafe DYLD environment variable")]
    UnsafeDyldEnvironment,
    #[error("FleetBar helper trust metadata could not be inspected safely")]
    InspectionFailed,
    #[error("live FleetBar process verification is supported only on macOS")]
    UnsupportedPlatform,
}

impl ProcessTrustError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidPid => "INVALID_PID",
            Self::ProcessUnavailable => "PROCESS_UNAVAILABLE",
            Self::IdentityMismatch => "FLEETBAR_IDENTITY_MISMATCH",
            Self::NotarizationRequired => "FLEETBAR_NOTARIZATION_REQUIRED",
            Self::HardenedRuntimeRequired => "FLEETBAR_HARDENED_RUNTIME_REQUIRED",
            Self::DebugPrivilegeRefused => "FLEETBAR_DEBUG_PRIVILEGE_REFUSED",
            Self::UnsafeEntitlement(_) => "FLEETBAR_UNSAFE_ENTITLEMENT",
            Self::UnsafeDyldEnvironment => "FLEETBAR_UNSAFE_DYLD_ENVIRONMENT",
            Self::InspectionFailed => "FLEETBAR_TRUST_INSPECTION_FAILED",
            Self::UnsupportedPlatform => "UNSUPPORTED_PLATFORM",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FleetBarProcessTrust {
    pub pid: i32,
    pub identity: &'static str,
    pub notarized: bool,
    pub hardened_runtime: bool,
    pub debug_privileges: bool,
    pub unsafe_dyld_environment: bool,
}

#[cfg(any(target_os = "macos", test))]
fn verify_hardening_policy(
    flags: u64,
    unsafe_entitlement: Option<&'static str>,
    unsafe_dyld_environment: bool,
) -> Result<(), ProcessTrustError> {
    if flags & CS_VALID == 0 {
        return Err(ProcessTrustError::IdentityMismatch);
    }
    if flags & CS_RUNTIME == 0 {
        return Err(ProcessTrustError::HardenedRuntimeRequired);
    }
    if flags & (CS_DEBUGGED | CS_GET_TASK_ALLOW) != 0 {
        return Err(ProcessTrustError::DebugPrivilegeRefused);
    }
    if let Some(entitlement) = unsafe_entitlement {
        return Err(ProcessTrustError::UnsafeEntitlement(entitlement));
    }
    if unsafe_dyld_environment {
        return Err(ProcessTrustError::UnsafeDyldEnvironment);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use core_foundation::base::{CFGetTypeID, CFRelease, CFType, CFTypeRef, OSStatus, TCFType};
    use core_foundation::boolean::{CFBoolean, CFBooleanGetTypeID};
    use core_foundation::dictionary::{
        CFDictionary, CFDictionaryGetTypeID, CFDictionaryGetValueIfPresent, CFDictionaryRef,
    };
    use core_foundation::number::{kCFNumberSInt64Type, CFNumber, CFNumberGetValue};
    use core_foundation::string::CFString;
    use security_framework_sys::code_signing::{
        kSecCSCheckTrustedAnchors, kSecCSConsiderExpiration, kSecCSStrictValidate,
        kSecGuestAttributePid, SecCodeCheckValidity, SecCodeCopyGuestWithAttributes, SecCodeRef,
        SecRequirementCreateWithString, SecRequirementRef,
    };
    use std::ffi::c_void;
    use std::ptr;

    const K_SEC_CS_SIGNING_INFORMATION: u32 = 1 << 1;
    const K_SEC_CS_DYNAMIC_INFORMATION: u32 = 1 << 3;
    const MAX_PROCESS_ARGUMENT_BYTES: usize = 1024 * 1024;

    const UNSAFE_ENTITLEMENTS: &[&str] = &[
        "com.apple.security.get-task-allow",
        "com.apple.security.cs.allow-dyld-environment-variables",
        "com.apple.security.cs.disable-library-validation",
        "com.apple.security.cs.allow-unsigned-executable-memory",
        "com.apple.security.cs.allow-jit",
    ];

    #[link(name = "Security", kind = "framework")]
    unsafe extern "C" {
        static kSecCodeInfoEntitlementsDict: CFTypeRef;
        static kSecCodeInfoStatus: CFTypeRef;
        fn SecCodeCopySigningInformation(
            code: SecCodeRef,
            flags: u32,
            information: *mut CFDictionaryRef,
        ) -> OSStatus;
    }

    struct OwnedCode(SecCodeRef);
    impl Drop for OwnedCode {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0.cast()) };
        }
    }

    struct OwnedRequirement(SecRequirementRef);
    impl Drop for OwnedRequirement {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0.cast()) };
        }
    }

    fn requirement(source: &str) -> Result<OwnedRequirement, ProcessTrustError> {
        let source = CFString::new(source);
        let mut requirement = ptr::null_mut();
        let status = unsafe {
            SecRequirementCreateWithString(source.as_concrete_TypeRef(), 0, &mut requirement)
        };
        if status != 0 || requirement.is_null() {
            return Err(ProcessTrustError::InspectionFailed);
        }
        Ok(OwnedRequirement(requirement))
    }

    fn process_code(pid: i32) -> Result<OwnedCode, ProcessTrustError> {
        let key = unsafe { CFString::wrap_under_get_rule(kSecGuestAttributePid) };
        let value = CFNumber::from(pid);
        let attributes = CFDictionary::from_CFType_pairs(&[(key, value)]);
        let mut code = ptr::null_mut();
        let status = unsafe {
            SecCodeCopyGuestWithAttributes(
                ptr::null_mut(),
                attributes.as_concrete_TypeRef(),
                0,
                &mut code,
            )
        };
        if status != 0 || code.is_null() {
            return Err(ProcessTrustError::ProcessUnavailable);
        }
        Ok(OwnedCode(code))
    }

    fn check_requirement(
        code: SecCodeRef,
        source: &str,
        error: ProcessTrustError,
    ) -> Result<(), ProcessTrustError> {
        let requirement = requirement(source)?;
        let flags = kSecCSStrictValidate | kSecCSCheckTrustedAnchors | kSecCSConsiderExpiration;
        let status = unsafe { SecCodeCheckValidity(code, flags, requirement.0) };
        if status == 0 {
            Ok(())
        } else {
            Err(error)
        }
    }

    fn dictionary_value(dictionary: CFDictionaryRef, key: CFTypeRef) -> Option<CFTypeRef> {
        let mut value: *const c_void = ptr::null();
        let present = unsafe { CFDictionaryGetValueIfPresent(dictionary, key.cast(), &mut value) };
        (present != 0 && !value.is_null()).then_some(value.cast_mut().cast())
    }

    fn signing_information(code: SecCodeRef) -> Result<CFDictionary, ProcessTrustError> {
        let mut information = ptr::null();
        let status = unsafe {
            SecCodeCopySigningInformation(
                code,
                K_SEC_CS_SIGNING_INFORMATION | K_SEC_CS_DYNAMIC_INFORMATION,
                &mut information,
            )
        };
        if status != 0 || information.is_null() {
            return Err(ProcessTrustError::InspectionFailed);
        }
        Ok(unsafe { CFDictionary::wrap_under_create_rule(information) })
    }

    fn status_flags(information: &CFDictionary) -> Result<u64, ProcessTrustError> {
        let value = dictionary_value(information.as_concrete_TypeRef(), unsafe {
            kSecCodeInfoStatus
        })
        .ok_or(ProcessTrustError::InspectionFailed)?;
        let value = unsafe { CFType::wrap_under_get_rule(value) }
            .downcast::<CFNumber>()
            .ok_or(ProcessTrustError::InspectionFailed)?;
        let mut flags = 0_i64;
        let converted = unsafe {
            CFNumberGetValue(
                value.as_concrete_TypeRef(),
                kCFNumberSInt64Type,
                (&mut flags as *mut i64).cast(),
            )
        };
        if !converted {
            return Err(ProcessTrustError::InspectionFailed);
        }
        Ok(flags as u64)
    }

    fn entitlement_is_true(
        information: &CFDictionary,
        entitlement: &'static str,
    ) -> Result<bool, ProcessTrustError> {
        let entitlements = match dictionary_value(information.as_concrete_TypeRef(), unsafe {
            kSecCodeInfoEntitlementsDict
        }) {
            Some(value) => value.cast::<c_void>() as CFDictionaryRef,
            None => return Ok(false),
        };
        if unsafe { CFGetTypeID(entitlements.cast()) } != unsafe { CFDictionaryGetTypeID() } {
            return Err(ProcessTrustError::InspectionFailed);
        }
        let key = CFString::new(entitlement);
        let Some(value) = dictionary_value(entitlements, key.as_CFTypeRef()) else {
            return Ok(false);
        };
        let type_id = unsafe { CFGetTypeID(value) };
        if type_id != unsafe { CFBooleanGetTypeID() } {
            return Err(ProcessTrustError::UnsafeEntitlement(entitlement));
        }
        let boolean = unsafe { CFBoolean::wrap_under_get_rule(value.cast()) };
        Ok(bool::from(boolean))
    }

    fn process_environment(pid: i32) -> Result<Vec<Vec<u8>>, ProcessTrustError> {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
        let mut size = 0_usize;
        let first = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                ptr::null_mut(),
                &mut size,
                ptr::null_mut(),
                0,
            )
        };
        if first != 0 || size < std::mem::size_of::<i32>() || size > MAX_PROCESS_ARGUMENT_BYTES {
            return Err(ProcessTrustError::InspectionFailed);
        }
        let mut buffer = vec![0_u8; size];
        let second = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                buffer.as_mut_ptr().cast(),
                &mut size,
                ptr::null_mut(),
                0,
            )
        };
        if second != 0 || size < std::mem::size_of::<i32>() {
            return Err(ProcessTrustError::ProcessUnavailable);
        }
        buffer.truncate(size);
        let argc = i32::from_ne_bytes(
            buffer[..4]
                .try_into()
                .map_err(|_| ProcessTrustError::InspectionFailed)?,
        ) as isize;
        if !(0..=65_536).contains(&argc) {
            return Err(ProcessTrustError::InspectionFailed);
        }

        let mut cursor = 4_usize;
        while cursor < buffer.len() && buffer[cursor] != 0 {
            cursor += 1;
        }
        while cursor < buffer.len() && buffer[cursor] == 0 {
            cursor += 1;
        }
        for _ in 0..argc {
            while cursor < buffer.len() && buffer[cursor] != 0 {
                cursor += 1;
            }
            if cursor >= buffer.len() {
                return Err(ProcessTrustError::InspectionFailed);
            }
            cursor += 1;
        }

        let mut environment = Vec::new();
        while cursor < buffer.len() {
            while cursor < buffer.len() && buffer[cursor] == 0 {
                cursor += 1;
            }
            if cursor >= buffer.len() {
                break;
            }
            let start = cursor;
            while cursor < buffer.len() && buffer[cursor] != 0 {
                cursor += 1;
            }
            environment.push(buffer[start..cursor].to_vec());
        }
        Ok(environment)
    }

    pub(super) fn verify(pid: i32) -> Result<FleetBarProcessTrust, ProcessTrustError> {
        if pid <= 0 {
            return Err(ProcessTrustError::InvalidPid);
        }
        let code = process_code(pid)?;
        check_requirement(
            code.0,
            FLEETBAR_DESIGNATED_REQUIREMENT,
            ProcessTrustError::IdentityMismatch,
        )?;
        check_requirement(code.0, "notarized", ProcessTrustError::NotarizationRequired)?;

        let information = signing_information(code.0)?;
        let flags = status_flags(&information)?;
        let mut unsafe_entitlement = None;
        for entitlement in UNSAFE_ENTITLEMENTS {
            if entitlement_is_true(&information, entitlement)? {
                unsafe_entitlement = Some(*entitlement);
                break;
            }
        }
        let unsafe_dyld_environment = process_environment(pid)?
            .iter()
            .any(|entry| entry.starts_with(b"DYLD_"));
        verify_hardening_policy(flags, unsafe_entitlement, unsafe_dyld_environment)?;

        Ok(FleetBarProcessTrust {
            pid,
            identity: "ai.portdaddy.FleetBar/P5H9P59X2M",
            notarized: true,
            hardened_runtime: true,
            debug_privileges: false,
            unsafe_dyld_environment: false,
        })
    }
}

/// Verify the exact live process connected to the enrollment pipes.
pub fn verify_fleetbar_process(pid: i32) -> Result<FleetBarProcessTrust, ProcessTrustError> {
    if pid <= 0 {
        return Err(ProcessTrustError::InvalidPid);
    }
    #[cfg(target_os = "macos")]
    {
        platform::verify(pid)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pid;
        Err(ProcessTrustError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAFE_FLAGS: u64 = CS_VALID | CS_RUNTIME;

    #[test]
    fn hardening_policy_accepts_only_valid_runtime_without_escape_hatches() {
        assert_eq!(verify_hardening_policy(SAFE_FLAGS, None, false), Ok(()));
        assert_eq!(
            verify_hardening_policy(CS_RUNTIME, None, false),
            Err(ProcessTrustError::IdentityMismatch)
        );
        assert_eq!(
            verify_hardening_policy(CS_VALID, None, false),
            Err(ProcessTrustError::HardenedRuntimeRequired)
        );
        assert_eq!(
            verify_hardening_policy(SAFE_FLAGS | CS_DEBUGGED, None, false),
            Err(ProcessTrustError::DebugPrivilegeRefused)
        );
        assert_eq!(
            verify_hardening_policy(SAFE_FLAGS | CS_GET_TASK_ALLOW, None, false),
            Err(ProcessTrustError::DebugPrivilegeRefused)
        );
        assert_eq!(
            verify_hardening_policy(
                SAFE_FLAGS,
                Some("com.apple.security.cs.disable-library-validation"),
                false,
            ),
            Err(ProcessTrustError::UnsafeEntitlement(
                "com.apple.security.cs.disable-library-validation"
            ))
        );
        assert_eq!(
            verify_hardening_policy(SAFE_FLAGS, None, true),
            Err(ProcessTrustError::UnsafeDyldEnvironment)
        );
    }
}
