/* LinkIQ - the fixed words written to "Ny aktivitet" in VVS-dialog.
 * An RPA reads these texts to close cases, so every installer must produce exactly the
 * same words. Change them here only (one place), and keep the spelling the RPA expects.
 *
 * results:  one is chosen per report
 * faults:   any number; each is written on its own line as faultPrefix + name ("Fejl T1")
 * statuses: the case status chosen in VVS-dialog's own status window (same spelling as there)
 */
window.LINKIQ_VVS_TEXT = {
  results: ['El og syn OK', 'El OK', 'Syn OK', 'Fejl'],
  faults: ['T1', 'T2', 'T3', 'Flowdele frem', 'Flowdele retur'],
  faultPrefix: 'Fejl ',
  commentPrefix: 'Bemærkning: ',
  statuses: ['Under behandling', 'Afventer'],
};
